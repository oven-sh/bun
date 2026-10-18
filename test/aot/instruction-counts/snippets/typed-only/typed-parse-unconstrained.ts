// parses an order of ten items with JSON.parse<T>(); the type has no constraints
interface Order {
  customer: { id: number; name: string; email: string };
  items: { sku: string; quantity: number; unitCents: number }[];
  coupon?: string;
}
const operations = 10;
const text = JSON.stringify({
  customer: { id: 4711, name: "Zoe Miller", email: "zoe@example.com" },
  items: Array.from({ length: 10 }, (_, n) => ({ sku: "SKU-" + (1000 + 37 * n), quantity: 1 + ((2 * n) % 5), unitCents: 199 + 350 * n })),
  coupon: "TENOFF",
});
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    if (JSON.parse<Order>(text).items.length === 10) total++;
  }
}

console.log(total);
