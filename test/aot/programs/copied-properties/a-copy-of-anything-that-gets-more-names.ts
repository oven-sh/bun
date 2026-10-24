// `{ ...source, name, id }` where no type says which names the source has: a type variable, `object`, `any`, `unknown` behind a cast. The copy is an object of its own with Object.prototype above it,
// it has the source's own enumerable properties as plain values in the source's order, a name that the source had keeps its place and takes the new value, and the source is left as it was.
const lines: string[] = [];
const describe = (value: object) => Reflect.ownKeys(value).map(key => {
  const d = Object.getOwnPropertyDescriptor(value, key)!;
  return String(key) + "=" + ("value" in d ? JSON.stringify(d.value) ?? String(d.value) : "accessor") + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
}).join(" ");
const show = (name: string, value: object) => void lines.push(name + " | " + describe(value) + " | " + (Object.getPrototypeOf(value) === Object.prototype ? "plain" : "OTHER PROTOTYPE") + (Object.isExtensible(value) ? "" : " NOT EXTENSIBLE"));

const stamp = <T extends object>(source: T, name: string, id: number): T & { name: string; id: number } => ({ ...source, name, id });
const stampObject = (source: object, name: string, id: number) => ({ ...source, name, id });
const stampAny = (source: any, name: string, id: number) => ({ ...source, name, id });
const stampThenSpread = <T extends object, U extends object>(source: T, other: U, id: number) => ({ ...source, id, ...other, last: true });
const stampUnderCondition = <T extends object>(source: T, on: boolean, id: number) => ({ ...source, ...(on && { id }), end: 1 });

class Point { x = 1; y = 2; #hidden = 3; get sum() { return this.x + this.y + this.#hidden; } static origin = new Point(); }
class Named extends Point { name = "of the class"; }
const symbol = Symbol("s");
let reads = 0;
const withGetter = { get computed() { reads++; return "read " + reads; }, plain: 1 };
const hidden = Object.defineProperty({ seen: 1 }, "unseen", { value: 2, enumerable: false });
const frozen = Object.freeze({ a: 1, name: "frozen" });
const sealed = Object.seal({ a: 1, id: "sealed" });
const inherits = Object.create({ above: 1 }, { own: { value: 2, enumerable: true } }) as object;
const without = Object.assign(Object.create(null) as object, { bare: 1 });
const proxied = new Proxy({ p: 1, q: 2 }, { ownKeys: target => { lines.push("ownKeys"); return Reflect.ownKeys(target).reverse(); }, get: (target, key) => { lines.push("get " + String(key)); return Reflect.get(target, key); } });
const sources: [string, object][] = [
  ["a record", { a: 1, b: "x" }], ["a record with both names", { id: "old", a: 1, name: "old" }], ["an empty record", {}],
  ["parsed", JSON.parse('{"a":2,"b":"parsed"}')], ["parsed with both names", JSON.parse('{"name":"old","z":1,"id":0}')], ["parsed with __proto__", JSON.parse('{"__proto__":{"evil":1},"a":1}')],
  ["indexes", { 2: "two", b: 1, 0: "zero" }], ["a symbol", { [symbol]: 1, a: 2 }], ["an instance", new Point()], ["an instance of a subclass", new Named()],
  ["a getter", withGetter], ["a hidden name", hidden], ["frozen", frozen], ["sealed", sealed], ["inherits", inherits], ["without a prototype", without], ["a proxy", proxied],
  ["a list", ["x", "y"]], ["a function", Object.assign(() => 1, { extra: 1 })], ["a map", new Map([[1, 2]])], ["a date", new Date(0)], ["an error", Object.assign(new Error("m"), { code: 1 })],
  ["a text object", new String("ab")], ["a typed array", new Uint8Array([7, 8])], ["arguments", (function (..._: number[]) { return arguments; })(1, 2)],
];
for (const [name, source] of sources) {
  const before = name === "a proxy" || name === "a getter" ? "" : describe(source);
  show(name + ", T", stamp(source, "n", 1));
  show(name + ", object", stampObject(source, "n", 2));
  show(name + ", any", stampAny(source, "n", 3));
  show(name + ", then another", stampThenSpread(source, { id: "other", more: 1 }, 4));
  show(name + ", under a condition", stampUnderCondition(source, name.length % 2 === 0, 5));
  if (before !== "" && before !== describe(source)) lines.push("THE SOURCE OF " + name + " HAS CHANGED: " + describe(source));
}
for (const source of [undefined, null, 0, 1.5, true, "", "ab", 10n, symbol]) show("any of " + String(source), stampAny(source, "n", 1));

const first = { a: 1, inner: { deep: 1 } };
const copy = stamp(first, "n", 1);
copy.a = 2; copy.inner.deep = 2; (copy as Record<string, unknown>).added = 3; delete (copy as Partial<typeof copy>).id;
show("the copy, changed", copy); show("its source", first);
const again = stamp(copy, "m", 9);
show("a copy of the copy", again);
function many(n: number): number { let sum = 0; for (let i = 0; i < n; i++) { const made = stamp(sources[i % 7][1], "s" + (i & 1), i); sum += made.id + made.name.length + Object.keys(made).length; } return sum; }
lines.push("many " + many(300));
const readers = [(o: { id: number; name: string }) => o.id + o.name, (o: { id: number; name: string }) => Object.entries(o).join(";"), (o: { id: number; name: string }) => JSON.stringify(o)];
for (const reader of readers) lines.push(reader(stamp({ z: 1 }, "r", 7)) + " | " + reader({ id: 1, name: "literal" }) + " | " + reader(stamp(JSON.parse('{"id":5}') as object, "p", 8)));
console.log(lines.join("\n"));
