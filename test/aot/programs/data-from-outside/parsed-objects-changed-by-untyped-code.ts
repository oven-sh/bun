// One generic reader with two calls: one result goes to a declared type, the other to `unknown` and is then changed in every way plain JavaScript allows.
// IR+ ^ .* = JSONSourceOpen v
interface OrderBody {
  customer: { id: number; name: string; email: string };
  items: { sku: string; quantity: number; unitCents: number }[];
  coupon?: string;
}
function read<T>(text: string): T {
  return JSON.parse(text);
}
function total(order: OrderBody): number {
  let sum = order.customer.id + order.customer.name.length;
  for (const item of order.items) sum += item.quantity * item.unitCents;
  return sum;
}
const text = '{"customer":{"id":1,"name":"n","email":"e"},"items":[{"sku":"a","quantity":2,"unitCents":3}],"coupon":"c"}';
console.log(total(read<OrderBody>(text)));
const deeds: [string, (value: any) => unknown][] = [
  ["store of another kind", v => (v.customer.id = "one")],
  ["store of another kind at the top", v => (v.customer = 5)],
  ["store into an item", v => (v.items[0].quantity = null)],
  ["new property", v => (v.customer.more = 1)],
  ["delete required", v => delete v.customer.name],
  ["delete at the top", v => delete v.items],
  ["accessor", v => Object.defineProperty(v.customer, "id", { get: () => 9, enumerable: true, configurable: true })],
  ["hidden", v => Object.defineProperty(v.customer, "email", { value: 1, enumerable: false })],
  ["prototype", v => Object.setPrototypeOf(v.customer, { inherited: 1 })],
  ["freeze", v => Object.freeze(v.customer)],
  ["seal and store", v => ((Object.seal(v.customer).id = "x"), 0)],
  ["assign", v => Object.assign(v.customer, { id: [1], name: {}, zzz: 1 })],
  ["symbol", v => (v.customer[Symbol.for("s")] = 1)],
  ["index", v => (v.customer[0] = "zero")],
  ["item replaced", v => (v.items[0] = "item")],
  ["items grown", v => v.items.push(1, "two", null)],
  ["as a prototype", v => Object.create(v.customer).id],
];
for (const [name, deed] of deeds) {
  const value: unknown = read<unknown>(text);
  let said: string;
  try {
    said = String(JSON.stringify(deed(value)));
  } catch (error) {
    said = "threw " + String(error).slice(0, 60);
  }
  const customer = (value as any).customer;
  console.log(name, "|", said, "|", JSON.stringify(value), "|", typeof customer === "object" ? Reflect.ownKeys(customer).map(String).join() + " " + Object.isFrozen(customer) + " " + (customer.inherited ?? "-") : customer);
}
