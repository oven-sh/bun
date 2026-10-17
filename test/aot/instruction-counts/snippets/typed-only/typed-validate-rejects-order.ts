// refuses an order of ten items, one of which is wrong, with safeValidate<T>()
import { safeValidate } from "bun";
import type { Int, Min, Max, MinLength, MaxLength, MinItems, MaxItems, Pattern, DeepStrict } from "bun";
interface Order {
  customer: { id: number & Int & Min<1>; name: string & MinLength<1> & MaxLength<100>; email: string & Pattern<"^[^@\\s]+@[^@\\s]+$"> };
  items: { sku: string & MinLength<1> & MaxLength<32>; quantity: number & Int & Min<1> & Max<1000>; unitCents: number & Int & Min<0> }[] & MinItems<1> & MaxItems<100>;
  coupon?: string & MaxLength<16>;
}
const operations = 5;
const text = JSON.stringify({
  customer: { id: 4711, name: "Zoe Miller", email: "zoe@example.com" },
  items: Array.from({ length: 10 }, (_, n) => ({ sku: "SKU-" + (1000 + 37 * n), quantity: 1 + ((2 * n) % 5), unitCents: 199 + 350 * n })),
  coupon: "TENOFF",
});
const body: any = JSON.parse(text);
body.items[9].quantity = 0;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    if (!safeValidate<Order>(body).success) total++;
  }
}

console.log(total);
