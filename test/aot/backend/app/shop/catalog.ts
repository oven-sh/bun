import { sql } from "../database";
import type { Customer, Product } from "./types";

export async function findCustomer(id: number): Promise<Customer | undefined> {
  const [customer] = await sql<Customer[]>`
    SELECT id, name, email, tier, country, orders_placed AS "ordersPlaced" FROM customer WHERE id = ${id}`;
  return customer;
}

export async function findProducts(shop: string, ids: number[]): Promise<Product[]> {
  return await sql<Product[]>`
    SELECT id, shop, sku, name, description, price_cents AS "priceCents", weight_grams AS "weightGrams", stock
    FROM product WHERE shop = ${shop} AND id = ANY(${sql.array(ids, "INT4")})`;
}

export async function findProduct(shop: string, id: number): Promise<Product | undefined> {
  const [product] = await findProducts(shop, [id]);
  return product;
}
