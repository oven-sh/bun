import type { BunRequest } from "bun";
import { shippingRates } from "./carrier-client";
import { findCustomer, findProduct, findProducts } from "./catalog";
import { orderLines, priceOrder, totalWeight } from "./pricing";
import { findSession } from "./sessions";
import { readOrder } from "./validation";

function problem(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function showProduct(request: BunRequest<"/api/shops/:shop/products/:id">): Promise<Response> {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return problem(400, "invalid product id");
  const product = await findProduct(request.params.shop, id);
  return product ? Response.json(product) : problem(404, "no such product");
}

export async function quoteOrder(request: BunRequest<"/api/shops/:shop/quotes">): Promise<Response> {
  const session = findSession(request);
  if (!session) return problem(401, "not signed in");

  const order = await readOrder(request);
  if (!order) return problem(400, "invalid order");

  const { shop } = request.params;
  const [customer, products] = await Promise.all([
    findCustomer(session.customerId),
    findProducts(
      shop,
      order.items.map(item => item.productId),
    ),
  ]);
  if (!customer) return problem(401, "not signed in");
  const lines = orderLines(order, products);
  if (!lines) return problem(422, "no such product");

  const rates = await shippingRates(order.shipTo.country, totalWeight(lines));
  const quote = priceOrder(shop, customer, order, lines, rates);
  return quote ? Response.json(quote) : problem(502, "the carrier offers no rate");
}
