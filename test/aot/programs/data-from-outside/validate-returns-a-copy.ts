// validate<T>(value) returns a copy and never changes its argument: the objects and arrays that T describes are new, and what stands under any, unknown, object or an undeclared key is shared.
import { JSON } from "bun"; import { validate } from "bun:bundle";
import type { Schema } from "bun";
interface Inner { x: number }
interface Item { sku: string; count: number }
interface Order {
  id: number;
  inner: Inner;
  items: Item[];
  tags: string[];
  byName: Record<string, Inner>;
  pair: [number, Inner];
  anything: unknown;
  loose: any;
  thing: object;
  note?: string;
  level: number & Schema.Default<1>;
}
const before = JSON.stringify({
  first: { undeclared: true }, id: 1, inner: { x: 1, more: [1] }, items: [{ sku: "a", count: 1 }], tags: ["t"], byName: { k: { x: 2 } }, pair: [1, { x: 3 }],
  anything: { deep: [1] }, loose: [{ x: "no number" }], thing: { x: "no number" },
});
const source = (): any => globalThis.JSON.parse(before);
function compare(what: string, result: any, given: any): void {
  const parts: [string, (from: any) => unknown][] = [
    ["itself", from => from], ["inner", from => from.inner], ["items", from => from.items], ["items[0]", from => from.items[0]], ["tags", from => from.tags], ["byName", from => from.byName],
    ["byName.k", from => from.byName.k], ["pair", from => from.pair], ["pair[1]", from => from.pair[1]], ["anything", from => from.anything], ["loose", from => from.loose], ["thing", from => from.thing],
    ["first", from => from.first], ["inner.more", from => from.inner.more],
  ];
  console.log(what, "new:", parts.filter(([, part]) => part(result) !== part(given)).map(([name]) => name).join(), "shared:", parts.filter(([, part]) => part(result) === part(given)).map(([name]) => name).join());
}

const given = source();
const result = validate<Order>(given);
compare("a plain object", result, given);
console.log(JSON.stringify(given) === before, Object.keys(given).join(), "|", Object.keys(result).join(), "|", Object.keys(result.inner).join(), result.level);
console.log(JSON.stringify(result));

result.id = 5;
result.inner.x = 6;
result.items.push({ sku: "b", count: 2 });
result.items[0].count = 7;
result.tags.push("u");
result.byName.l = { x: 8 };
result.pair[1].x = 9;
result.note = "n";
console.log("after stores into the copy", JSON.stringify(given) === before);
const copied = JSON.stringify(result);
given.id = "text";
given.inner.x = "text";
given.items.push(7);
given.items[0].count = "text";
given.tags.push(8);
given.byName.k.x = "text";
given.pair[0] = "text";
delete given.inner;
console.log("after stores into the argument", JSON.stringify(result) === copied, result.id + result.inner.x + result.items[0].count + result.pair[0]);
given.anything.deep.push(2);
(result.loose as any[]).push(3);
console.log("what is shared", JSON.stringify(result.anything), JSON.stringify(given.loose));

const again = validate<Order>(result);
compare("a T already", again, result);
again.inner.x = 100;
console.log(result.inner.x, again.inner.x, JSON.stringify(again) === JSON.stringify(result).replace('"x":6', '"x":100'));

interface Values { id: number; inner: Inner; tags: string[] }
const values: Values = { id: 1, inner: { x: 1 }, tags: ["t"] };
const wider = { ...values, items: [{ sku: "a", count: 1 }], byName: { k: { x: 2 } }, pair: [1, { x: 3 }], anything: values, loose: values, thing: values, first: values };
const widened = validate<Order>(wider);
console.log("made by typed code as another type", (widened as unknown) !== wider, widened.inner !== values.inner, widened.tags !== values.tags, widened.anything === values, widened.thing === values, JSON.stringify(widened));
widened.inner.x = 50;
widened.tags.push("u");
console.log(values.inner.x, values.tags.length, wider.inner.x, Object.keys(wider).join());

function freeze(value: any): any {
  if (typeof value === "object" && value !== null) Object.values(Object.freeze(value)).forEach(freeze);
  return value;
}
const frozen = freeze(source());
const thawed = validate<Order>(frozen);
thawed.id = 2;
thawed.inner.x = 3;
thawed.items.push({ sku: "b", count: 2 });
thawed.note = "n";
console.log("a frozen argument", Object.isFrozen(frozen), [thawed, thawed.inner, thawed.items, thawed.items[0], thawed.pair, thawed.byName].map(Object.isFrozen).join(), Object.isFrozen(thawed.anything), JSON.stringify(frozen) === before, thawed.id + thawed.inner.x + thawed.items.length);

const refused = source();
refused.pair[1].x = "3";
try {
  validate<Order>(refused);
} catch (error) {
  console.log("a refusal", (error as Schema.Error).issues.map(issue => issue.path.join(".")).join(), Object.keys(refused).join(), JSON.stringify(refused) === before.replace('"x":3', '"x":"3"'));
}

// JSON.parse<T> checks what a reviver returns and hands it on as it is: the program holds that object, and a copy would be another one.
const kept: any = { x: 4, more: [1] };
const revived = JSON.parse<Omit<Order, "level">>(before, (key, value) => (key === "inner" ? kept : value));
revived.inner.x = 5;
console.log("what a reviver returns", (revived.inner as unknown) !== kept, kept.x, (revived.inner as any).more === kept.more, Object.keys(revived).join());

const list = [{ x: 1 }, { x: 2 }];
const listed = validate<Inner[]>(list);
const twice = validate<{ a: Inner; b: Inner }>({ a: list[0], b: list[0] });
console.log("roots and repeats", listed !== list, listed[0] !== list[0], twice.a !== twice.b, validate<number>(5), validate<string | null>(null), validate<unknown>(list) === list);
