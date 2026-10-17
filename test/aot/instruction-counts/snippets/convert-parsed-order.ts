// parses a request body behind an untyped function, casts it to a record type that the program also makes, and reads it: a nested record and an array of records
type Order = { customer: { id: number; name: string }; items: { sku: string; quantity: number }[]; coupon?: string };
const operations = 20;
const parse = (text: string): any => JSON.parse(text);
const made = (i: number): Order => ({ customer: { id: i, name: "made" }, items: [{ sku: "m", quantity: i }], coupon: "C" });
const read = (order: Order) => {
  let sum = order.customer.id + order.customer.name.length;
  for (const item of order.items) sum += item.sku.length + item.quantity;
  return sum;
};
const text = JSON.stringify(made(7));
let total = read(made(1));

kernel: {
  for (let i = 0; i < operations; i++) total += read(parse(text) as Order);
}

console.log(total);
