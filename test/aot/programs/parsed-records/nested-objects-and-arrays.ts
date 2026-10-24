const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Item { sku: string; quantity: number }
interface Customer { id: number; name: string }
interface Order { customer: Customer; items: Item[]; note?: string; history: Order[] }
function count(order: Order): number {
  let sum = order.customer.id;
  for (const item of order.items) sum += item.quantity * item.sku.length;
  for (const earlier of order.history) sum += count(earlier);
  return sum;
}
function names(order: Order): string {
  return [order.customer.name, ...order.items.map(item => item.sku), ...order.history.map(names)].join("/");
}
const made: Order = { customer: { id: 1, name: "a" }, items: [{ sku: "s", quantity: 2 }], history: [] };
leak(made);
console.log(count(made), names(made));
function text(depth: number): string {
  const items = Array.from({ length: depth + 1 }, (_, n) => `{"sku":"sku-${n}","quantity":${n + 1}}`).join();
  const history = depth ? `${text(depth - 1)},${text(depth - 1)}` : "";
  return `{"customer":{"id":${depth},"name":"c${depth}"},"items":[${items}],"history":[${history}]}`;
}
for (let round = 0; round < 3; round++) {
  for (let depth = 0; depth < 5; depth++) {
    const order = parse(text(depth));
    console.log(count(order), names(order).length, JSON.stringify(order) === text(depth));
  }
  const mixed = parse('[{"sku":"a","quantity":1},{"quantity":2,"sku":"b"},{"sku":"c"},{"sku":"d","quantity":4,"x":1},[{"sku":"e","quantity":5}],null,7,{"id":1,"name":"n"}]');
  console.log(JSON.stringify(mixed), mixed.map((value: any) => (value && typeof value === "object" ? Object.keys(value).join("+") : String(value))).join());
  const shared = parse('{"customer":{"id":1,"name":"x"},"items":[],"history":[]}');
  const other = parse('{"customer":{"id":1,"name":"x"},"items":[],"history":[]}');
  console.log(shared !== other, shared.customer !== other.customer, shared.items !== other.items);
}
export {};
