// Bun.validate<T>(), Bun.safeValidate<T>() and Bun.parse<T>() check a value against the TypeScript type T: what they accept, what they refuse and why, and what the copy they return holds.
import type { Int, Min, Max, MinLength, MaxLength, MinItems, MaxItems, Pattern, Message, Default, Strict, DeepStrict, Format, MultipleOf, Above, Below } from "bun";

interface Order {
  customer: { id: number & Int & Min<1>; name: string & MinLength<1> & MaxLength<100>; email: string & Pattern<"^[^@\\s]+@[^@\\s]+$"> };
  items: { sku: string & MinLength<1> & MaxLength<32>; quantity: number & Int & Min<1> & Max<1000>; unitCents: number & Int & Min<0> }[] & MinItems<1> & MaxItems<100>;
  coupon?: string & MaxLength<16>;
}
const text = JSON.stringify({ customer: { id: 4711, name: "Zoe", email: "zoe@example.com", more: 1 }, items: [{ sku: "SKU-1", quantity: 2, unitCents: 199, more: 2 }, { sku: "SKU-2", quantity: 3, unitCents: 5 }], coupon: "TENOFF", more: 3 });
const fresh = (): any => JSON.parse(text);
const altered = (change: (body: any) => void): any => { const body = fresh(); change(body); return body; };
const shown = (result: { success: true; data: unknown } | { success: false; issues: { path: (string | number)[]; code: string; expected: string; received: string; message: string }[] }): string =>
  result.success ? "accepted " + JSON.stringify(result.data) : "refused " + result.issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected + " " + issue.received).join("; ");

console.log(shown(Bun.safeValidate<Order>(fresh())));
console.log(shown(Bun.safeValidate<Order & DeepStrict>(fresh())));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.customer.id = 0; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.customer.id = 1.5; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.customer.id = "1"; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.customer.id = NaN; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.customer.name = ""; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.customer.email = "nobody"; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.items = []; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.items = {}; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.items[1].quantity = 1001; body.items[0].sku = 5; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { delete body.coupon; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.coupon = undefined; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.coupon = null; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { body.coupon = "12345678901234567"; }))));
console.log(shown(Bun.safeValidate<Order>(altered(body => { delete body.customer; }))));
console.log(shown(Bun.safeValidate<Order>(null)), shown(Bun.safeValidate<Order>([])), shown(Bun.safeValidate<Order>("order")), shown(Bun.safeValidate<Order>(undefined)));

const order = Bun.validate<Order>(fresh());
let sum = order.customer.id;
for (const item of order.items) sum += item.quantity * item.unitCents;
console.log(sum, Object.keys(order).join(), Object.keys(order.customer).join(), Object.keys(order.items[0]).join(), order.coupon);
try {
  Bun.validate<Order>(altered(body => { body.items[1].unitCents = -1; }));
} catch (error: any) {
  console.log(error instanceof TypeError, error.message, JSON.stringify(error.issues));
}

enum Color { Red, Green = 5, Blue = "blue" }
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "none" };
interface Tree { value: number; children: Tree[]; parent?: Tree | null }
interface Forms {
  text: string; count: number; flag: boolean; nothing: null; maybe?: string; either: string | number; literal: "a" | "b" | 3 | true; color: Color;
  pair: [string, number]; byName: Record<string, number>; shapes: Shape[]; shape: Shape | null; tree: Tree; anything: unknown; list: number[][];
  nested: { deep: { deeper: { deepest: boolean } } }; optionalObject?: { x: number }; big: bigint; "with-dash": number; objectOrText: { a: number } | string;
}
const forms = (): any => ({
  text: "t", count: 1.5, flag: false, nothing: null, either: 5, literal: 3, color: "blue", pair: ["p", 2], byName: { a: 1, b: 2 },
  shapes: [{ kind: "circle", radius: 1, extra: 1 }, { kind: "none" }], shape: null, tree: { value: 1, children: [{ value: 2, children: [], parent: null }] }, anything: { whatever: [1] },
  list: [[1], [], [2, 3]], nested: { deep: { deeper: { deepest: true } } }, big: 5n, "with-dash": 1, objectOrText: { a: 1 },
});
const attempt = (label: string, change: (value: any) => void): void => {
  const value = forms(); change(value);
  const result = Bun.safeValidate<Forms>(value);
  console.log(label, result.success ? "accepted" : result.issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected + " " + issue.received).join("; "));
};
const whole = Bun.validate<Forms>(forms());
console.log(JSON.stringify({ ...whole, big: String(whole.big) }));
attempt("as it is", () => {});
attempt("text", v => { v.text = 1; });
attempt("count", v => { v.count = "1"; });
attempt("count infinite", v => { v.count = Infinity; });
attempt("flag", v => { v.flag = 0; });
attempt("nothing", v => { delete v.nothing; });
attempt("maybe", v => { v.maybe = null; });
attempt("maybe given", v => { v.maybe = "m"; });
attempt("either", v => { v.either = true; });
attempt("literal", v => { v.literal = "c"; });
attempt("literal true", v => { v.literal = true; });
attempt("color", v => { v.color = 1; });
attempt("color 5", v => { v.color = 5; });
attempt("pair", v => { v.pair = ["p"]; });
attempt("pair types", v => { v.pair = [1, "p"]; });
attempt("byName", v => { v.byName.c = "3"; });
attempt("shapes", v => { v.shapes.push({ kind: "triangle" }); });
attempt("shapes member", v => { v.shapes[0].radius = "1"; });
attempt("shape", v => { v.shape = { kind: "square", side: 2 }; });
attempt("shape undefined", v => { v.shape = undefined; });
attempt("tree", v => { v.tree.children[0].children.push({ value: "3", children: [] }); });
attempt("list", v => { v.list[2][1] = "3"; });
attempt("deepest", v => { v.nested.deep.deeper.deepest = "yes"; });
attempt("optionalObject", v => { v.optionalObject = { x: "1" }; });
attempt("optionalObject good", v => { v.optionalObject = { x: 1 }; });
attempt("big", v => { v.big = 5; });
attempt("dash", v => { delete v["with-dash"]; });
attempt("objectOrText", v => { v.objectOrText = "text"; });
attempt("objectOrText bad", v => { v.objectOrText = 5; });

console.log(shown(Bun.safeValidate<string>("s")), shown(Bun.safeValidate<string>(5)), shown(Bun.safeValidate<number[]>([1, 2])), shown(Bun.safeValidate<number[]>([1, "2"])), shown(Bun.safeValidate<string | undefined>(undefined)), shown(Bun.safeValidate<"a" | "b">("c")));

interface Settings {
  port: number & Int & Min<1> & Max<65535> & Default<8080>;
  host: string & Default<"localhost">;
  verbose: boolean & Default<false>;
  ratio: number & Above<0> & Below<1> & Message<"the ratio lies between 0 and 1">;
  step: number & MultipleOf<5>;
  address: string & Format<"ipv4">;
  id: string & Format<"uuid">;
  day: string & Format<"date">;
}
const settings = (): any => ({ ratio: 0.5, step: 10, address: "10.0.0.1", id: "123e4567-e89b-12d3-a456-426614174000", day: "2026-10-16" });
console.log(shown(Bun.safeValidate<Settings>(settings())));
console.log(shown(Bun.safeValidate<Settings>({ ...settings(), port: 0, host: 5, ratio: 1, step: 7, address: "10.0.0.256", id: "no", day: "2026-13-01" })));
const refusedRatio = Bun.safeValidate<Settings>({ ...settings(), ratio: 2 });
console.log(refusedRatio.success ? "" : refusedRatio.issues[0].message);

interface Partly { some: number; known: string; [key: string]: unknown }
interface PartlyNumbers { some: number; [key: string]: number }
const partly = Bun.validate<Partly>(JSON.parse('{"before":1,"some":2,"0":"zero","known":"k","__proto__":{"polluted":true},"toString":"mine","after":[1]}'));
console.log(JSON.stringify(partly), Object.keys(partly).join(), partly.some + 1, partly.known, Object.getPrototypeOf(partly) === Object.prototype, ({} as any).polluted, typeof partly.toString);
console.log(shown(Bun.safeValidate<PartlyNumbers>({ some: 1, other: 2 })), shown(Bun.safeValidate<PartlyNumbers>({ some: 1, other: "2" })));
console.log(shown(Bun.safeValidate<{ a: number } & Strict>({ a: 1, b: 2 })), shown(Bun.safeValidate<{ a: { b: number } } & Strict>({ a: { b: 1, c: 2 } })));

function own<T>(value: unknown): string { return "the program's own function was handed " + typeof value; }
{
  const Bun = { validate: own };
  console.log(Bun.validate<number>("not a number"));
}

interface Token { kind: string; start: number; end: number; text?: string; flags?: number }
const token = Bun.parse<Token>('{"end":9,"kind":"name","more":[1,2],"start":4,"text":5,"flags":3}');
console.log(JSON.stringify(token), Object.keys(token).join(), token.end - token.start, token.text, token.flags);
token.start += 1; token.text = "t";
console.log(JSON.stringify(token));
for (const wrong of ['{"kind":"name","start":4}', '{"kind":"name","start":"4","end":9}', "[]", "null", "5", '{"kind":'] ) {
  try { console.log(JSON.stringify(Bun.parse<Token>(wrong))); } catch (error: any) { console.log(error.constructor.name, error.constructor === SyntaxError ? "" : error.message); }
}
const tokens = Bun.parse<Token[]>('[{"kind":"a","start":0,"end":1},{"kind":"b","start":1,"end":3,"other":true}]');
let length = 0;
for (const each of tokens) length += each.end - each.start;
console.log(length, JSON.stringify(tokens));
interface Loose { some: number; known: number; [key: string]: unknown }
const loose = Bun.parse<Loose>('{"a":1,"some":2,"known":3,"values":[1,2],"__proto__":{"x":1},"0":"zero","hasOwnProperty":"mine"}');
console.log(JSON.stringify(loose), Object.keys(loose).join(), loose.some + loose.known, JSON.stringify({ ...loose }), Object.getPrototypeOf(loose) === Object.prototype);
const names: string[] = []; for (const name in loose) names.push(name); console.log(names.join());
interface Outer { inner: { kept: number; [key: string]: unknown }; strictly: { only: number } }
console.log(JSON.stringify(Bun.parse<Outer>('{"inner":{"kept":1,"also":2},"strictly":{"only":3,"gone":4},"gone":5}')));
console.log(JSON.stringify(JSON.parse('{"untouched":{"a":1}}')), Bun.parse<number>("5") + 1, Bun.parse<string | null>("null"));
const untyped: Token = JSON.parse('{"kind":1}');
console.log(JSON.stringify(untyped));

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
console.log(JSON.stringify(Bun.validate<Json>(JSON.parse('{"a":[1,"two",[null,{"b":true}]],"c":{}}'))), shown(Bun.safeValidate<Json>({ a: [1, [undefined]] })), shown(Bun.safeValidate<Json>([[[[5n]]]])));
type Nest = number | Nest[];
console.log(JSON.stringify(Bun.validate<Nest>([1, [2, [3, []]]])), shown(Bun.safeValidate<Nest>([1, [2, ["3"]]])));
console.log(shown(Bun.safeValidate<{ 0: string; "1a": number }>({ 0: "zero", "1a": 1, 2: "gone" })), shown(Bun.safeValidate<{ 0?: string }>({ 0: 5 })));
