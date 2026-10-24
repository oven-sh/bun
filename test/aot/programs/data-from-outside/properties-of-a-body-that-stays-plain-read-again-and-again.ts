// A parsed body is cast to a record type and stays the object it is; its properties (a record, arrays, an optional text) are read by typed code again and again, with stores from outside in between.
type Customer = { id: number; name: string; tags: string[] };
type Item = { sku: string; quantity: number };
type Order = { customer: Customer; items: Item[]; coupon?: string; spare: Customer | null };

class Incoming {
  #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  json<T = any>(): Promise<T> {
    return Promise.resolve(this.#text).then((text: string) => JSON.parse(text));
  }
}
const made = (i: number): Order => ({ customer: { id: i, name: "made", tags: [] }, items: [{ sku: "m", quantity: i }], coupon: "C", spare: null });
function read(order: Order): number {
  let sum = order.customer.id + order.customer.name.length + order.customer.tags.length + (order.coupon === undefined ? 0 : order.coupon.length);
  for (const item of order.items) sum += item.sku.length + item.quantity;
  if (order.spare !== null) sum += order.spare.id;
  return sum;
}
const texts = [
  JSON.stringify(made(7)),
  `{"customer":{"id":1,"name":"first","tags":["a","b"]},"items":[],"spare":null}`,
  `{"customer":{"id":2,"name":"second","tags":[]},"items":[{"sku":"x","quantity":1},{"sku":"yy","quantity":2.5}],"coupon":"","spare":{"id":40,"name":"spare","tags":["t"]}}`,
  `{"spare":null,"items":[{"quantity":3,"sku":"other order"}],"customer":{"tags":["z"],"name":"third","id":3},"more":true}`,
];
console.log("made here", read(made(1)));
for (let round = 0; round < 4; round++) {
  for (const text of texts) {
    const body: any = await new Incoming(text).json();
    const customer = body.customer;
    const items = body.items;
    const first = read(body as Order);
    const second = read(body as Order);
    console.log(round, first, second, body.customer === customer, body.items === items, Object.keys(body).join(), Object.keys(customer).join());
    items.push({ sku: "pushed", quantity: 10 });
    customer.tags.push("pushed");
    customer.id += 100;
    body.items = items.slice(0);
    body.coupon = "changed";
    console.log(round, read(body as Order), body.items === items, JSON.stringify(body));
    body.customer = { id: 5, name: "replaced", tags: [] };
    body.spare = customer;
    console.log(round, read(body as Order), body.spare === customer);
  }
}
