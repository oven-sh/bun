// validates an order of ten items with safeValidate<T>(); the type has no constraints
import { safeValidate } from "bun";
interface Order {
  customer: { id: number; name: string; email: string };
  items: { sku: string; quantity: number; unitCents: number }[];
  coupon?: string;
}
const operations = 20;
const text = JSON.stringify({
  customer: { id: 4711, name: "Zoe Miller", email: "zoe@example.com" },
  items: Array.from({ length: 10 }, (_, n) => ({ sku: "SKU-" + (1000 + 37 * n), quantity: 1 + ((2 * n) % 5), unitCents: 199 + 350 * n })),
  coupon: "TENOFF",
});
const body: unknown = JSON.parse(text);
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    if (safeValidate<Order>(body).success) total++;
  }
}

console.log(total);
