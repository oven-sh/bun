// A parsed body is cast to a record type and read by typed code. The cast takes any object and changes nothing: the body and the objects below it stay the same ordinary objects, and untyped code stores whatever it likes into them afterwards. A field of the wrong kind throws where typed code reads it.
type Customer = { id: number; name: string; tags: string[] };
type Item = { sku: string; quantity: number };
type Order = { customer: Customer; items: Item[]; coupon?: string };

let parsed: any;
let parsedCustomer: any;
let sharedCustomer: any = null;
class Incoming {
  #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  json<T = any>(): Promise<T> {
    return Promise.resolve(this.#text).then((text: string) => {
      parsed = JSON.parse(text);
      if (sharedCustomer !== null) parsed.customer = sharedCustomer;
      parsedCustomer = parsed.customer;
      return parsed;
    });
  }
}
function makeOrder(i: number): Order {
  return { customer: { id: i, name: "made", tags: [] }, items: [{ sku: "m", quantity: i }], coupon: "C" };
}
function weigh(order: Order): number {
  let sum = order.customer.id + order.customer.name.length + order.customer.tags.length;
  for (const item of order.items) sum += item.sku.length + item.quantity;
  return sum + (order.coupon === undefined ? 0 : order.coupon.length);
}
function attempt(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
async function weighBody(incoming: Incoming): Promise<string> {
  try {
    const order = (await incoming.json()) as Order;
    return String(weigh(order)) + (order === parsed && order.customer === parsedCustomer ? "" : " not the same object");
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function body(i: number, customer: string, rest: string): Incoming {
  return new Incoming('{"customer":' + customer + ',"items":[{"sku":"a' + i + '","quantity":' + i + '},{"sku":"b","quantity":2}]' + rest + "}");
}
const good = (i: number) => '{"id":' + i + ',"name":"name ' + i + '","tags":["x"]}';

console.log(weigh(makeOrder(1)));
let sum = 0;
const kept: any[] = [];
for (let i = 0; i < 600; i++) {
  sum += Number(await weighBody(body(i, good(i), i % 3 === 0 ? ',"coupon":"TEN"' : "")));
  kept.push(parsed);
}
console.log(sum);
console.log(JSON.stringify(kept[7]), Object.keys(kept[7]).join(), Object.keys(kept[7].customer).join());
console.log(JSON.stringify(kept[9]), Object.keys(kept[9]).join());
console.log(attempt(() => { kept[7].customer.id = "text"; return kept[7].customer.id; }));
console.log(attempt(() => { kept[7].customer.id = 70; return kept[7].customer.id; }));
console.log(attempt(() => { kept[7].coupon = 5; return kept[7].coupon; }));
console.log(attempt(() => { kept[7].more = "more"; return JSON.stringify(kept[7]); }));

for (const [name, customer, rest] of [
  ["a coupon of the wrong kind", good(1), ',"coupon":5'],
  ["a customer of the wrong kind", '{"id":"text","name":"n","tags":[]}', ""],
  ["a customer that lacks a field", '{"id":1,"name":"n"}', ""],
  ["a customer with one more", '{"id":1,"name":"n","tags":[],"more":true}', ""],
  ["no customer", "null", ""],
  ["one more property", good(1), ',"more":[1]'],
]) {
  const outcome = await weighBody(body(1, customer, rest));
  const below = parsedCustomer;
  console.log(name + ":", outcome, JSON.stringify(parsed), attempt(() => { below.id = "text"; return below.id; }));
}

sharedCustomer = JSON.parse(good(9));
console.log(await weighBody(body(1, "null", "")), await weighBody(body(2, "null", "")), attempt(() => { sharedCustomer.id = "text"; return sharedCustomer.id; }));
