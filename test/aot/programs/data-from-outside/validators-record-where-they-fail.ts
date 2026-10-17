// A compiled validator that refuses a value hands over where it failed, so what it has accepted is not walked again. The issues are the same as from a walk of the whole value.
// IR+ ^function \d+ "recordFailure"
import type { Int, Max, MaxItems, Min, MinItems, MinLength, Strict } from "bun";
interface Item { sku: string & MinLength<2>; quantity: number & Int & Min<1> & Max<9>; note?: string }
interface Customer { id: number & Int; name: string; address: { street: string; zip: string & MinLength<5> } }
interface Order { customer: Customer; items: Item[] & MinItems<1> & MaxItems<4>; rows: Item[][]; coupon?: string; total: number }
type Sealed = { inner: { a: number; b: string } & Strict; last: boolean } & Strict;
type Mixed = { pair: [Item, number]; byName: Record<string, Item>; either: Item | null; many: (Item | string)[]; tail: Item };
const show = (result: { success: boolean; issues?: { path: (string | number)[]; code: string; expected: string }[] }): string =>
  result.success ? "accepted" : result.issues!.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected).join("; ");
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
  console.log(show(Bun.safeValidate<Order>(value)));
  const text = JSON.stringify(value);
  try { Bun.parse<Order>(text); console.log("parsed"); } catch (error) { console.log(show({ success: false, issues: (error as any).issues })); }
}
for (const text of ['{"inner":{"a":1,"b":"b"},"last":true}', '{"inner":{"a":1,"b":"b","c":1},"last":1}', '{"inner":{"a":"1","b":"b","c":1},"last":true,"more":1}', '{"inner":[],"last":true,"more":1}', "[]"]) console.log(show(Bun.safeValidate<Sealed>(JSON.parse(text))));
const mixed = (): any => JSON.parse(`{"pair":[${one},1],"byName":{"x":${one}},"either":${one},"many":[${one},"s"],"tail":${one}}`);
for (const change of [() => {}, (value: any) => { value.pair[0].sku = 1; }, (value: any) => { value.byName.x.quantity = 0; value.tail.sku = "a"; }, (value: any) => { value.either.sku = 1; }, (value: any) => { value.either = null; value.many[0].quantity = 0; }, (value: any) => { value.tail = undefined; }]) {
  const value = mixed();
  change(value);
  console.log(show(Bun.safeValidate<Mixed>(value)));
}
const nested = order();
Object.defineProperty(nested, "total", { enumerable: true, get() { return show(Bun.safeValidate<Customer>(JSON.parse('{"id":"x","name":1}'))).length; } });
nested.customer.id = "1";
console.log(show(Bun.safeValidate<Order>(nested)));
const throwing = order();
throwing.items[0].sku = 1;
Object.defineProperty(throwing, "total", { enumerable: true, get() { throw new RangeError("from a getter"); } });
try { Bun.safeValidate<Order>(throwing); } catch (error) { console.log(String(error)); }
const after = order();
after.total = "3";
console.log(show(Bun.safeValidate<Order>(after)), "|", show(Bun.safeValidate<Order>(order())));
try { Bun.validate<Order>(after); } catch (error) { console.log((error as Error).message, (error as any).issues.length); }
console.log(JSON.stringify(Bun.schema<Order>()["~standard"].validate(after)));
