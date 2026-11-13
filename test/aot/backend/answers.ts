// What the backend must answer, computed from the rules and from schema.sql alone. No server and no database is asked.
//
//   bun answers.ts <folder>     writes the files that measure/measure.py reads: <test>.answer, quote.<n>.request, quote.<n>.answer

const fortuneMessages = [
  "fortune: No such file or directory",
  "A computer scientist is someone who fixes things that aren't broken.",
  "After enough decimal places, nobody gives a damn.",
  "A bad random number generator: 1, 1, 1, 1, 1, 4.33e+67, 1, 1, 1",
  "A computer program does what you tell it to do, not what you want it to do.",
  "Emacs is a nice operating system, but I prefer UNIX. — Tom Christaensen",
  "Any program that runs right is obsolete.",
  "A list is only as strong as its weakest link. — Donald Knuth",
  "Feature: A bug with seniority.",
  "Computers make very fast, very accurate mistakes.",
  '<script>alert("This should not be displayed in a browser alert box.");</script>',
  "フレームワークのベンチマーク",
];

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

export const fortunesPage =
  "<!DOCTYPE html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>" +
  [{ id: 0, message: "Additional fortune added at request time." }, ...fortuneMessages.map((message, index) => ({ id: index + 1, message }))]
    .sort((a, b) => Buffer.compare(Buffer.from(a.message), Buffer.from(b.message)))
    .map(({ id, message }) => `<tr><td>${id}</td><td>${message.replace(/[&<>"']/g, character => escapes[character]!)}</td></tr>`)
    .join("") +
  "</table></body></html>";

export const plaintext = "Hello, World!";
export const json = '{"message":"Hello, World!"}';

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function customer(id: number) {
  return {
    id,
    name: `Customer ${id}`,
    email: `customer${id}@example.com`,
    tier: ["standard", "silver", "gold"][id % 3]!,
    ordersPlaced: (id * 7) % 40,
  };
}

export function product(id: number) {
  return {
    id,
    shop: ["west", "east"][id % 2]!,
    sku: `SKU-${pad(id, 5)}`,
    name: `${["Kettle", "Lamp", "Notebook", "Backpack", "Teapot", "Blanket", "Speaker"][id % 7]} No. ${id}`,
    description: `Item ${id} of the catalog. Made to order, checked by hand, and shipped in a box that can be used again.`,
    priceCents: 199 + ((id * 37) % 9800),
    weightGrams: 80 + ((id * 13) % 2400),
    stock: (id * 11) % 60,
  };
}

export function sessionToken(customerId: number) {
  return `session-${pad(customerId, 4)}-${new Bun.CryptoHasher("md5").update(`session ${customerId}`).digest("hex")}`;
}

export function carrierRates(country: string, grams: number) {
  const base = { PT: 390, JP: 1290, US: 990, KE: 1490, NO: 690 }[country]!;
  const steps = Math.floor(grams / 100);
  return [
    { service: "express", cents: base * 3 + steps * 35, days: 2 },
    { service: "standard", cents: Math.floor((base * 3) / 2) + steps * 18, days: 5 },
    { service: "economy", cents: base + steps * 12, days: 9 },
  ];
}

export interface Order {
  items: { productId: number; quantity: number; note?: string }[];
  shipTo: { name: string; street: string; city: string; postalCode: string; country: string };
  coupon?: string;
  giftWrap: boolean;
}

const percentOf = (cents: number, percent: number) => Math.floor((cents * percent + 50) / 100);

export function quote(shop: string, customerId: number, order: Order) {
  const buyer = customer(customerId);
  const lines = order.items.map(item => {
    const bought = product(item.productId);
    return {
      productId: bought.id,
      sku: bought.sku,
      name: bought.name,
      description: bought.description,
      quantity: item.quantity,
      unitCents: bought.priceCents,
      totalCents: bought.priceCents * item.quantity,
      weightGrams: bought.weightGrams * item.quantity,
      inStock: bought.stock >= item.quantity,
      note: item.note ?? null,
    };
  });
  const weightGrams = lines.reduce((sum, line) => sum + line.weightGrams, 0);
  const options = carrierRates(order.shipTo.country, weightGrams).sort((a, b) => a.cents - b.cents);
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const discountPercent = { standard: 0, silver: 5, gold: 10 }[buyer.tier]! + (order.coupon === "WELCOME10" ? 10 : 0);
  const discountCents = percentOf(subtotalCents, discountPercent);
  const giftWrapCents = order.giftWrap ? 250 * lines.length : 0;
  const shippingCents = order.coupon === "FREESHIP" ? 0 : options[0]!.cents;
  const taxPercent = { PT: 23, JP: 10, US: 0, KE: 16, NO: 25 }[order.shipTo.country]!;
  const taxCents = percentOf(subtotalCents - discountCents + giftWrapCents, taxPercent);
  return JSON.stringify({
    shop,
    customer: { id: buyer.id, name: buyer.name, email: buyer.email, tier: buyer.tier, returning: buyer.ordersPlaced > 0 },
    shipTo: order.shipTo,
    lines,
    shipping: { chosen: options[0], options, weightGrams },
    totals: {
      subtotalCents,
      discountPercent,
      discountCents,
      giftWrapCents,
      shippingCents,
      taxPercent,
      taxCents,
      totalCents: subtotalCents - discountCents + giftWrapCents + shippingCents + taxCents,
    },
    currency: "EUR",
  });
}

const addresses = [
  { name: "Ana Sousa", street: "Rua das Flores 12", city: "Lisbon", postalCode: "1200-195", country: "PT" },
  { name: "Haruto Sato", street: "2-11-3 Meguro", city: "Osaka", postalCode: "530-0001", country: "JP" },
  { name: "Grace Miller", street: "1600 Glenarm Place", city: "Denver", postalCode: "80202", country: "US" },
  { name: "Wanjiru Kamau", street: "Moi Avenue 48", city: "Nairobi", postalCode: "00100", country: "KE" },
  { name: "Ingrid Berg", street: "Storgata 7", city: "Oslo", postalCode: "0155", country: "NO" },
];

// Eight orders of five lines each in the shop "west", whose products have even ids. Each is placed by another customer.
export const orders = Array.from({ length: 8 }, (_, n) => {
  const order: Order = {
    items: Array.from({ length: 5 }, (_, k) => ({
      productId: 2 + ((n * 262 + k * 394) % 1998),
      quantity: 1 + ((n + k * 2) % 5),
      ...(k === 1 ? { note: "a gift" } : {}),
    })),
    shipTo: addresses[n % addresses.length]!,
    ...(n % 3 === 0 ? { coupon: "WELCOME10" } : n % 3 === 1 ? { coupon: "FREESHIP" } : {}),
    giftWrap: n % 2 === 0,
  };
  const customerId = 42 + n * 101;
  return { token: sessionToken(customerId), request: JSON.stringify(order), answer: quote("west", customerId, order) };
});

const first = JSON.parse(orders[0]!.request) as Order;

// Bodies that must be answered 400 {"error":"invalid order"}.
export const badOrders: Record<string, string> = {
  "text that is not JSON": "{",
  "no items": JSON.stringify({ ...first, items: [] }),
  "a quantity of zero": JSON.stringify({ ...first, items: [{ productId: 2, quantity: 0 }] }),
  "a quantity that is no integer": JSON.stringify({ ...first, items: [{ productId: 2, quantity: 1.5 }] }),
  "a product id that is a string": JSON.stringify({ ...first, items: [{ productId: "2", quantity: 1 }] }),
  "an unknown key": JSON.stringify({ ...first, express: true }),
  "an unknown key within an item": JSON.stringify({ ...first, items: [{ productId: 2, quantity: 1, color: "red" }] }),
  "no address": JSON.stringify({ items: first.items, giftWrap: false }),
  "a country that is not served": JSON.stringify({ ...first, shipTo: { ...first.shipTo, country: "XX" } }),
  "a coupon that is null": JSON.stringify({ ...first, coupon: null }),
  "giftWrap that is a string": JSON.stringify({ ...first, giftWrap: "yes" }),
  "an array": "[]",
};

if (import.meta.main) {
  const folder = process.argv[2];
  if (!folder) throw new Error("usage: bun answers.ts <folder>");
  await Bun.write(`${folder}/plaintext.answer`, plaintext);
  await Bun.write(`${folder}/json.answer`, json);
  await Bun.write(`${folder}/fortunes.answer`, fortunesPage);
  await Bun.write(`${folder}/product.answer`, JSON.stringify(product(2)));
  for (const [n, { token, request, answer }] of orders.entries()) {
    await Bun.write(`${folder}/quote.${n}.request`, `${token}\n${request}`);
    await Bun.write(`${folder}/quote.${n}.answer`, answer);
  }
}
