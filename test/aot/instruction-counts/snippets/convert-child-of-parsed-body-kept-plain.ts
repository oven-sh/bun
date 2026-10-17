// awaits a parsed request body from a method that returns Promise<T> with T = any, casts it to a record type that takes plain objects as they are, and reads it: the body and its items stay plain, the customer is converted
type Order = { customer: { id: number; name: string; tags: string[] }; items: { sku: string; quantity: number }[]; coupon?: string };
const operations = 100;
class Incoming {
  #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  json<T = any>(): Promise<T> {
    return Promise.resolve(this.#text).then((text: string) => JSON.parse(text));
  }
}
const made = (i: number): Order => ({ customer: { id: i, name: "made", tags: [] }, items: [{ sku: "m", quantity: i }], coupon: "C" });
const read = (order: Order) => {
  let sum = order.customer.id + order.customer.name.length + order.customer.tags.length;
  for (const item of order.items) sum += item.sku.length + item.quantity;
  return sum;
};
const incoming = new Incoming(JSON.stringify(made(7)));
let total = read(made(1));

kernel: {
  for (let i = 0; i < operations; i++) total += read((await incoming.json()) as Order);
}

console.log(total);
