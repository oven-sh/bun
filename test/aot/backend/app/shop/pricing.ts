import type { Country, Customer, Line, Product, Quote, Rate, Tier } from "./types";
import type { Order } from "./validation";

const tierDiscount: Record<Tier, number> = { standard: 0, silver: 5, gold: 10 };

const taxPercent: Record<Country, number> = { PT: 23, JP: 10, US: 0, KE: 16, NO: 25 };

const giftWrapCentsPerLine = 250;

function percentOf(cents: number, percent: number): number {
  return Math.floor((cents * percent + 50) / 100);
}

export function orderLines(order: Order, products: Product[]): Line[] | undefined {
  const byId = new Map(products.map(product => [product.id, product]));
  const lines: Line[] = [];
  for (const item of order.items) {
    const product = byId.get(item.productId);
    if (!product) return undefined;
    lines.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      quantity: item.quantity,
      unitCents: product.priceCents,
      totalCents: product.priceCents * item.quantity,
      weightGrams: product.weightGrams * item.quantity,
      inStock: product.stock >= item.quantity,
      note: item.note ?? null,
    });
  }
  return lines;
}

export function totalWeight(lines: Line[]): number {
  return lines.reduce((grams, line) => grams + line.weightGrams, 0);
}

export function priceOrder(shop: string, customer: Customer, order: Order, lines: Line[], rates: Rate[]): Quote | undefined {
  const options = rates.toSorted((a, b) => a.cents - b.cents);
  const chosen = options[0];
  if (!chosen) return undefined;

  const subtotalCents = lines.reduce((cents, line) => cents + line.totalCents, 0);
  const discountPercent = tierDiscount[customer.tier] + (order.coupon === "WELCOME10" ? 10 : 0);
  const discountCents = percentOf(subtotalCents, discountPercent);
  const giftWrapCents = order.giftWrap ? giftWrapCentsPerLine * lines.length : 0;
  const shippingCents = order.coupon === "FREESHIP" ? 0 : chosen.cents;
  const taxCents = percentOf(subtotalCents - discountCents + giftWrapCents, taxPercent[order.shipTo.country]);

  return {
    shop,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      tier: customer.tier,
      returning: customer.ordersPlaced > 0,
    },
    shipTo: order.shipTo,
    lines,
    shipping: { chosen, options, weightGrams: totalWeight(lines) },
    totals: {
      subtotalCents,
      discountPercent,
      discountCents,
      giftWrapCents,
      shippingCents,
      taxPercent: taxPercent[order.shipTo.country],
      taxCents,
      totalCents: subtotalCents - discountCents + giftWrapCents + shippingCents + taxCents,
    },
    currency: "EUR",
  };
}
