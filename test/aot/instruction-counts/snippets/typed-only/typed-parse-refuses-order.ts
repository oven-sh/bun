// refuses an order of ten items, one of which is wrong, with JSON.parse<T>()
import type { Schema } from "bun";
interface Order {
  customer: { id: number & Schema.Int & Schema.Min<1>; name: string & Schema.MinLength<1> & Schema.MaxLength<100>; email: string & Schema.Pattern<"^[^@\\s]+@[^@\\s]+$"> };
  items: { sku: string & Schema.MinLength<1> & Schema.MaxLength<32>; quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<1000>; unitCents: number & Schema.Int & Schema.Min<0> }[] & Schema.MinItems<1> & Schema.MaxItems<100>;
  coupon?: string & Schema.MaxLength<16>;
}
const operations = 5;
const text = JSON.stringify({
  customer: { id: 4711, name: "Zoe Miller", email: "zoe@example.com" },
  items: Array.from({ length: 10 }, (_, n) => ({ sku: "SKU-" + (1000 + 37 * n), quantity: n === 9 ? 0 : 1 + ((2 * n) % 5), unitCents: 199 + 350 * n })),
  coupon: "TENOFF",
});
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    try {
      JSON.parse<Order>(text);
    } catch {
      total++;
    }
  }
}

console.log(total);
