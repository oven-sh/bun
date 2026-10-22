// A value that a compiled validator refuses is walked by the routine that all types share. The issues are the same wherever in the value the validator stopped.
import type { Schema } from "bun";
interface Item { sku: string & Schema.MinLength<2>; quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<9>; note?: string }
interface Customer { id: number & Schema.Int; name: string; address: { street: string; zip: string & Schema.MinLength<5> } }
interface Order { customer: Customer; items: Item[] & Schema.MinItems<1> & Schema.MaxItems<4>; rows: Item[][]; coupon?: string; total: number }
type Sealed = { inner: { a: number; b: string } & Schema.Strict; last: boolean } & Schema.Strict;
type Mixed = { pair: [Item, number]; byName: Record<string, Item>; either: Item | null; many: (Item | string)[]; tail: Item };
function attempt(parse: () => unknown): string {
  try {
    parse();
    return "accepted";
  } catch (error) {
    return (error as Bun.Schema.Error).issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected).join("; ");
  }
}
const one = '{"sku":"ab","quantity":2}';
const item = (): any => JSON.parse(one);
const order = (): any => JSON.parse(`{"customer":{"id":1,"name":"n","address":{"street":"s","zip":"12345"}},"items":[${one},${one},${one}],"rows":[[${one}],[${one},${one}]],"total":3}`);
const changes: ((value: any) => void)[] = [
  () => {},
  value => { value.customer = 1; },
  value => { value.customer.id = 1.5; },
  value => { value.customer.address.zip = "1"; },
  value => { value.customer.address = null; value.total = "3"; },
  value => { value.customer.name = 1; value.customer.address.street = 2; value.items[1].quantity = 0.5; value.coupon = 4; },
  value => { value.items[0].quantity = 0.5; },
  value => { value.items[0].quantity = 99.5; value.items[2].sku = "a"; value.items[2].quantity = "2"; },
  value => { value.items[2] = null; },
  value => { value.items = []; },
  value => { value.items = [item(), item(), item(), item(), 5]; },
  value => { value.items = "none"; value.rows = [[]]; },
  value => { value.rows[1][1].sku = ""; value.rows[0][0].note = 1; },
  value => { value.rows[0] = 7; value.rows[1][0].quantity = 10; value.total = null; },
  value => { delete value.total; },
];
for (const change of changes) {
  const value = order();
  change(value);
  console.log(attempt(() => JSON.parse<Order>(JSON.stringify(value))));
}
for (const text of ['{"inner":{"a":1,"b":"b"},"last":true}', '{"inner":{"a":1,"b":"b","c":1},"last":1}', '{"inner":{"a":"1","b":"b","c":1},"last":true,"more":1}', '{"inner":[],"last":true,"more":1}', "[]"]) console.log(attempt(() => JSON.parse<Sealed>(text)));
const mixed = (): any => JSON.parse(`{"pair":[${one},1],"byName":{"x":${one}},"either":${one},"many":[${one},"s"],"tail":${one}}`);
for (const change of [() => {}, (value: any) => { value.pair[0].sku = 1; }, (value: any) => { value.byName.x.quantity = 0; value.tail.sku = "a"; }, (value: any) => { value.either.sku = 1; }, (value: any) => { value.either = null; value.many[0].quantity = 0; }, (value: any) => { value.tail = undefined; }]) {
  const value = mixed();
  change(value);
  console.log(attempt(() => JSON.parse<Mixed>(JSON.stringify(value))));
}
const nested = order();
nested.customer.id = "1";
console.log(attempt(() => JSON.parse<Order>(JSON.stringify(nested), (key, value) => (key === "total" ? attempt(() => JSON.parse<Customer>('{"id":"x","name":1}')).length : value))));
const throwing = order();
throwing.items[0].sku = 1;
try { JSON.parse<Order>(JSON.stringify(throwing), key => { if (key === "total") throw new RangeError("from a reviver"); }); } catch (error) { console.log(String(error)); }
const after = order();
after.total = "3";
console.log(attempt(() => JSON.parse<Order>(JSON.stringify(after))), "|", attempt(() => JSON.parse<Order>(JSON.stringify(order()))));
