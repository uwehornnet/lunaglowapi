import { NextResponse } from "next/server";
import shopifyServer from "@/lib/shopify.server.js";

const SHOPIFY_HOST_NAME = process.env.SHOPIFY_HOST_NAME;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOP_DOMAIN = "https://lunaglow.de";
const CURRENCY = "EUR";

const CSV_HEADERS = [
	"id",
	"title",
	"description",
	"link",
	"image_link",
	"additional_image_link",
	"availability",
	"price",
	"sale_price",
	"brand",
	"condition",
	"gtin",
	"identifier_exists",
	"product_type",
	"item_group_id",
	"color",
	"size",
	"material",
	"shipping_weight",
];

function escapeCsv(str) {
	if (!str) return "";
	const value = String(str);
	if (value.includes('"') || value.includes(",") || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function stripHtml(html) {
	if (!html) return "";
	return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function getAvailability(variant, productStatus) {
	if (productStatus !== "active") return "out_of_stock";
	if (variant.inventory_management === null) return "in_stock";
	return variant.inventory_quantity > 0 ? "in_stock" : "out_of_stock";
}

function getVariantOptionByName(product, variant, optionName) {
	const option = product.options?.find(
		(o) => o.name.toLowerCase() === optionName.toLowerCase()
	);
	if (!option) return null;
	return variant[`option${option.position}`] || null;
}

function buildItemRow(product, variant) {
	const variantId = variant.sku || `shopify_${product.id}_${variant.id}`;
	const title = variant.title !== "Default Title"
		? `${product.title} - ${variant.title}`
		: product.title;
	const description = stripHtml(product.body_html);
	const link = `${SHOP_DOMAIN}/products/${product.handle}`;
	const imageLink = product.images?.[0]?.src || "";
	const additionalImages = (product.images?.slice(1) || []).map((img) => img.src).join(",");
	const availability = getAvailability(variant, product.status);
	const brand = product.vendor || "";
	const barcode = variant.barcode || "";
	const productType = product.product_type || "";

	const color = getVariantOptionByName(product, variant, "Color")
		|| getVariantOptionByName(product, variant, "Farbe") || "";
	const size = getVariantOptionByName(product, variant, "Size")
		|| getVariantOptionByName(product, variant, "Größe") || "";
	const material = getVariantOptionByName(product, variant, "Material") || "";

	const hasSalePrice = variant.compare_at_price && parseFloat(variant.compare_at_price) > parseFloat(variant.price);
	const salePrice = hasSalePrice ? `${parseFloat(variant.price).toFixed(2)} ${CURRENCY}` : "";
	const regularPrice = hasSalePrice
		? `${parseFloat(variant.compare_at_price).toFixed(2)} ${CURRENCY}`
		: `${parseFloat(variant.price).toFixed(2)} ${CURRENCY}`;

	const weight = variant.weight && variant.weight > 0
		? `${variant.weight} ${variant.weight_unit || "kg"}`
		: "";

	const identifierExists = barcode ? "" : "false";

	const row = [
		variantId,
		title,
		description,
		link,
		imageLink,
		additionalImages,
		availability,
		regularPrice,
		salePrice,
		brand,
		"new",
		barcode,
		identifierExists,
		productType,
		product.id,
		color,
		size,
		material,
		weight,
	];

	return row.map(escapeCsv).join(",");
}

async function fetchAllProducts(adminRESTClient) {
	let products = [];
	let params = {
		path: "products.json",
		query: {
			fields: "id,title,handle,variants,images,body_html,vendor,product_type,status,options,tags",
			limit: "250",
		},
	};

	let response = await adminRESTClient.get(params);
	products = products.concat(response.body.products);

	while (response.pageInfo?.nextPage) {
		response = await adminRESTClient.get({
			path: "products.json",
			query: response.pageInfo.nextPage.query,
		});
		products = products.concat(response.body.products);
	}

	return products;
}

export async function GET() {
	try {
		if (!SHOPIFY_HOST_NAME || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
			return NextResponse.json({ error: "Missing Shopify credentials" }, { status: 500 });
		}

		const adminSession = {
			shop: SHOPIFY_HOST_NAME,
			accessToken: SHOPIFY_ADMIN_ACCESS_TOKEN,
		};

		const adminRESTClient = new shopifyServer.clients.Rest({ session: adminSession });
		const products = await fetchAllProducts(adminRESTClient);

		const rows = products
			.filter((p) => p.status === "active")
			.flatMap((product) =>
				product.variants.map((variant) => buildItemRow(product, variant))
			);

		const csv = [CSV_HEADERS.join(","), ...rows].join("\n");

		return new NextResponse(csv, {
			status: 200,
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
			},
		});
	} catch (error) {
		console.error("Error generating Google Merchant feed:", error);
		return new NextResponse(error.message, {
			status: 500,
			headers: {
				"Content-Type": "text/plain",
			},
		});
	}
}
