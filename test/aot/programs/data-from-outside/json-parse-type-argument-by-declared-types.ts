// JSON.parse<T>(text) checks what the text holds against the TypeScript type T: what it accepts, what it refuses and why, and what it returns.
import type { Schema } from "bun";

interface Order {
  customer: { id: number & Schema.Int & Schema.Min<1>; name: string & Schema.MinLength<1> & Schema.MaxLength<100>; email: string & Schema.Pattern<"^[^@\\s]+@[^@\\s]+$"> };
  items: { sku: string & Schema.MinLength<1> & Schema.MaxLength<32>; quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<1000>; unitCents: number & Schema.Int & Schema.Min<0> }[] & Schema.MinItems<1> & Schema.MaxItems<100>;
  coupon?: string & Schema.MaxLength<16>;
}
const text = JSON.stringify({ customer: { id: 4711, name: "Zoe", email: "zoe@example.com", more: 1 }, items: [{ sku: "SKU-1", quantity: 2, unitCents: 199, more: 2 }, { sku: "SKU-2", quantity: 3, unitCents: 5 }], coupon: "TENOFF", more: 3 });
const altered = (change: (body: any) => void): string => { const body = JSON.parse(text); change(body); return JSON.stringify(body); };
const listed = (issues: Schema.Issue[]): string => issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected + " " + issue.received).join("; ");
function shown(parse: () => unknown): string {
  try {
    return "accepted " + JSON.stringify(parse());
  } catch (error) {
    return "refused " + listed((error as Bun.Schema.Error).issues);
  }
}

console.log(shown(() => JSON.parse<Order>(text)));
console.log(shown(() => JSON.parse<Order & Schema.DeepStrict>(text)));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.customer.id = 0; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.customer.id = 1.5; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.customer.id = "1"; }))));
console.log(shown(() => JSON.parse<Order>(text.replace("4711", "1e400"))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.customer.name = ""; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.customer.email = "nobody"; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.items = []; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.items = {}; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.items[1].quantity = 1001; body.items[0].sku = 5; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { delete body.coupon; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.coupon = null; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { body.coupon = "12345678901234567"; }))));
console.log(shown(() => JSON.parse<Order>(altered(body => { delete body.customer; }))));
console.log(shown(() => JSON.parse<Order>("null")), shown(() => JSON.parse<Order>("[]")), shown(() => JSON.parse<Order>('"order"')));

const order = JSON.parse<Order>(text);
let sum = order.customer.id;
for (const item of order.items) sum += item.quantity * item.unitCents;
console.log(sum, Object.keys(order).join(), Object.keys(order.customer).join(), Object.keys(order.items[0]).join(), order.coupon);
try {
  JSON.parse<Order>(altered(body => { body.items[1].unitCents = -1; }));
} catch (error: any) {
  console.log(error instanceof TypeError, error.message, JSON.stringify(error.issues));
}

enum Color { Red, Green = 5, Blue = "blue" }
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "none" };
interface Tree { value: number; children: Tree[]; parent?: Tree | null }
interface Forms {
  text: string; count: number; flag: boolean; nothing: null; maybe?: string; either: string | number; literal: "a" | "b" | 3 | true; color: Color;
  pair: [string, number]; byName: Record<string, number>; shapes: Shape[]; shape: Shape | null; tree: Tree; anything: unknown; list: number[][];
  nested: { deep: { deeper: { deepest: boolean } } }; optionalObject?: { x: number }; "with-dash": number; objectOrText: { a: number } | string;
}
const forms = (): any => ({
  text: "t", count: 1.5, flag: false, nothing: null, either: 5, literal: 3, color: "blue", pair: ["p", 2], byName: { a: 1, b: 2 },
  shapes: [{ kind: "circle", radius: 1, extra: 1 }, { kind: "none" }], shape: null, tree: { value: 1, children: [{ value: 2, children: [], parent: null }] }, anything: { whatever: [1] },
  list: [[1], [], [2, 3]], nested: { deep: { deeper: { deepest: true } } }, "with-dash": 1, objectOrText: { a: 1 },
});
const attempt = (label: string, change: (value: any) => void): void => {
  const value = forms(); change(value);
  const answer = shown(() => JSON.parse<Forms>(JSON.stringify(value)));
  console.log(label, answer.startsWith("accepted ") ? "accepted" : answer.slice("refused ".length));
};
console.log(JSON.stringify(JSON.parse<Forms>(JSON.stringify(forms()))));
attempt("as it is", () => {});
attempt("text", v => { v.text = 1; });
attempt("count", v => { v.count = "1"; });
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
attempt("shape missing", v => { delete v.shape; });
attempt("tree", v => { v.tree.children[0].children.push({ value: "3", children: [] }); });
attempt("list", v => { v.list[2][1] = "3"; });
attempt("deepest", v => { v.nested.deep.deeper.deepest = "yes"; });
attempt("optionalObject", v => { v.optionalObject = { x: "1" }; });
attempt("optionalObject good", v => { v.optionalObject = { x: 1 }; });
attempt("anything missing", v => { delete v.anything; });
attempt("dash", v => { delete v["with-dash"]; });
attempt("objectOrText", v => { v.objectOrText = "text"; });
attempt("objectOrText bad", v => { v.objectOrText = 5; });

console.log(shown(() => JSON.parse<string>('"s"')), shown(() => JSON.parse<string>("5")), shown(() => JSON.parse<number[]>("[1,2]")), shown(() => JSON.parse<number[]>('[1,"2"]')), shown(() => JSON.parse<"a" | "b">('"c"')));

interface Settings {
  port: number & Schema.Int & Schema.Min<1> & Schema.Max<65535> & Schema.Default<8080>;
  host: string & Schema.Default<"localhost">;
  verbose: boolean & Schema.Default<false>;
  ratio: number & Schema.Above<0> & Schema.Below<1> & Schema.Message<"the ratio lies between 0 and 1">;
  step: number & Schema.MultipleOf<5>;
  address: string & Schema.Format<"ipv4">;
  id: string & Schema.Format<"uuid">;
  day: string & Schema.Format<"date">;
}
const settings = { ratio: 0.5, step: 10, address: "10.0.0.1", id: "123e4567-e89b-12d3-a456-426614174000", day: "2026-10-16" };
console.log(shown(() => JSON.parse<Settings>(JSON.stringify(settings))));
console.log(shown(() => JSON.parse<Settings>(JSON.stringify({ host: "example.com", ...settings, port: 80 }))));
console.log(shown(() => JSON.parse<Settings>(JSON.stringify({ ...settings, port: 0, host: 5, ratio: 1, step: 7, address: "10.0.0.256", id: "no", day: "2026-13-01" }))));
try {
  JSON.parse<Settings>(JSON.stringify({ ...settings, ratio: 2 }));
} catch (error) {
  console.log((error as Bun.Schema.Error).issues[0].message);
}

interface Partly { some: number; known: string; [key: string]: unknown }
interface PartlyNumbers { some: number; [key: string]: number }
const partly = JSON.parse<Partly>('{"before":1,"some":2,"0":"zero","known":"k","__proto__":{"polluted":true},"toString":"mine","after":[1]}');
console.log(JSON.stringify(partly), Object.keys(partly).join(), partly.some + 1, partly.known, Object.getPrototypeOf(partly) === Object.prototype, ({} as any).polluted, typeof partly.toString);
console.log(shown(() => JSON.parse<PartlyNumbers>('{"some":1,"other":2}')), shown(() => JSON.parse<PartlyNumbers>('{"some":1,"other":"2"}')));
console.log(shown(() => JSON.parse<{ a: number } & Schema.Strict>('{"a":1,"b":2}')), shown(() => JSON.parse<{ a: { b: number } } & Schema.Strict>('{"a":{"b":1,"c":2}}')));

interface Token { kind: string; start: number; end: number; text?: string; flags?: number }
const token = JSON.parse<Token>('{"end":9,"kind":"name","more":[1,2],"start":4,"flags":3}');
console.log(JSON.stringify(token), Object.keys(token).join(), token.end - token.start, token.text, token.flags);
token.start += 1; token.text = "t";
console.log(JSON.stringify(token));
for (const wrong of ['{"kind":"name","start":4}', '{"kind":"name","start":"4","end":9}', '{"kind":"name","start":4,"end":9,"text":5}', "[]", "null", "5", '{"kind":'] ) {
  try { console.log(JSON.stringify(JSON.parse<Token>(wrong))); } catch (error: any) { console.log(error.constructor.name, error.constructor === SyntaxError ? "" : error.message); }
}
const tokens = JSON.parse<Token[]>('[{"kind":"a","start":0,"end":1},{"kind":"b","start":1,"end":3,"other":true}]');
let length = 0;
for (const each of tokens) length += each.end - each.start;
console.log(length, JSON.stringify(tokens));
interface Loose { some: number; known: number; [key: string]: unknown }
const loose = JSON.parse<Loose>('{"a":1,"some":2,"known":3,"values":[1,2],"__proto__":{"x":1},"0":"zero","hasOwnProperty":"mine"}');
console.log(JSON.stringify(loose), Object.keys(loose).join(), loose.some + loose.known, JSON.stringify({ ...loose }), Object.getPrototypeOf(loose) === Object.prototype);
const names: string[] = []; for (const name in loose) names.push(name); console.log(names.join());
interface Outer { inner: { kept: number; [key: string]: unknown }; plainly: { only: number } }
console.log(JSON.stringify(JSON.parse<Outer>('{"inner":{"kept":1,"also":2},"plainly":{"only":3,"more":4},"more":5}')));
console.log(JSON.stringify(JSON.parse('{"untouched":{"a":1}}')), JSON.parse<number>("5") + 1, JSON.parse<string | null>("null"));
const untyped: Token = JSON.parse('{"kind":1}');
console.log(JSON.stringify(untyped));

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
console.log(JSON.stringify(JSON.parse<Json>('{"a":[1,"two",[null,{"b":true}]],"c":{}}')));
type Nest = number | Nest[];
console.log(JSON.stringify(JSON.parse<Nest>("[1,[2,[3,[]]]]")), shown(() => JSON.parse<Nest>('[1,[2,["3"]]]')));
console.log(shown(() => JSON.parse<{ 0: string; "1a": number }>('{"0":"zero","1a":1,"2":"two"}')), shown(() => JSON.parse<{ 0?: string }>('{"0":5}')));
