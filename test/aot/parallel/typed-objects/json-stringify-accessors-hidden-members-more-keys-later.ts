// Objects whose members are accessors, read-only, hidden or methods, and that get more keys later, are written as JSON.
function show(label: string, run: () => string | undefined): void {
  let text: string | undefined = "";
  try { for (let i = 0; i < 40; i++) text = run(); } catch (error) { text = "throws " + (error as Error).name; }
  console.log(label + ": " + text);
}
const log: string[] = [];
function definedGetter(n: number) { const o: any = {}; Object.defineProperty(o, "sign", { get() { return "got" + n; }, enumerable: true }); o.later = n; return o; }
show("a getter defined on an empty literal", () => JSON.stringify(definedGetter(1)));
function definedGetterLast(n: number) { const o: any = { first: n }; o.second = "s"; Object.defineProperty(o, "sign", { get() { return [n]; }, set(v) { log.push(String(v)); }, enumerable: true, configurable: true }); return o; }
show("a getter defined last", () => JSON.stringify(definedGetterLast(2)));
function hiddenGetter(n: number) { const o: any = { first: n }; Object.defineProperty(o, "sign", { get() { return "never"; }, enumerable: false }); o.later = n; return o; }
show("a hidden getter", () => JSON.stringify(hiddenGetter(3)));
function hiddenData(n: number) { const o: any = { first: n }; Object.defineProperty(o, "mid", { value: "hidden", enumerable: false, writable: true }); o.later = n; return o; }
show("a hidden value", () => JSON.stringify(hiddenData(4)));
function readOnlyData(n: number) { const o: any = { first: n }; Object.defineProperty(o, "mid", { value: "fixed", enumerable: true }); o.later = n; return o; }
show("a read-only value", () => JSON.stringify(readOnlyData(5)));
function literalGetter(n: number) { const o: any = { first: n, get mid() { return "from the literal " + this.first; } }; o.later = n; if (n & 1) o.odd = true; return o; }
show("a getter in the literal", () => JSON.stringify([literalGetter(6), literalGetter(7)]));
function setterOnly(n: number) { const o: any = { first: n, set mid(v: unknown) { log.push("set"); } }; o.later = n; return o; }
show("a setter alone", () => JSON.stringify(setterOnly(8)));
function withMethod(n: number) { const o: any = { first: n, run() { return 1; }, arrow: () => 2 }; o.later = n; o.handler = function () {}; o.last = "l"; return o; }
show("methods and functions", () => JSON.stringify(withMethod(9)));
function methodWithToJSON(n: number) { const o: any = { first: n }; const f: any = () => 1; f.toJSON = () => "a function with toJSON"; o.run = f; o.later = n; return o; }
show("a function with toJSON", () => JSON.stringify(methodWithToJSON(10)));
function getterThatChanges(n: number) { const o: any = { first: n }; Object.defineProperty(o, "mid", { get() { delete o.later; o.added = 1; return "changed"; }, enumerable: true, configurable: true }); o.later = n; o.last = "l"; return o; }
show("a getter that changes its object", () => JSON.stringify(getterThatChanges(11)));
function getterThatThrows(n: number) { const o: any = { first: n }; Object.defineProperty(o, "mid", { get() { throw new RangeError("no"); }, enumerable: true }); o.later = n; return o; }
show("a getter that throws", () => JSON.stringify(getterThatThrows(12)));
function manyDefined(n: number) { const o: any = {}; Object.defineProperties(o, { a: { value: n, enumerable: true }, b: { get() { return "b"; }, enumerable: true }, c: { value: "c" }, d: { value: null, enumerable: true, writable: true } }); o.e = n; return o; }
show("several defined at once", () => JSON.stringify(manyDefined(13)));
function redefined(n: number) { const o: any = { a: n, b: "data" }; o.c = 1; Object.defineProperty(o, "b", { get() { return "now a getter"; }, enumerable: true }); return o; }
show("a value replaced by a getter", () => JSON.stringify(redefined(14)));
function backToData(n: number) { const o: any = { a: n, get b() { return "getter"; } }; o.c = 1; Object.defineProperty(o, "b", { value: "now data", enumerable: true }); return o; }
show("a getter replaced by a value", () => JSON.stringify(backToData(15)));
class Base { x = 1; get viaPrototype() { return "not own"; } }
class WithAccessor extends Base { accessor held = "in an accessor field"; y?: number; z?: string; }
function instance(n: number) { const o = new WithAccessor(); if (n & 1) o.z = "z"; o.y = n; return o; }
show("an instance with accessors above it", () => JSON.stringify([instance(16), instance(17)]));
const name = ["comp", "uted"].join("");
class Computed { a = 1; [name] = "under a computed key"; b?: number; c?: number }
function computed(n: number) { const o = new Computed(); if (n & 1) o.c = n; o.b = n; return o; }
show("a field under a computed key", () => JSON.stringify([computed(18), computed(19)]));
const tag = Symbol("tag");
function symbols(n: number) { const o: any = { a: n, [tag]: "symbol", [Symbol.iterator]: null }; o.b = n; o[Symbol.for("later")] = 1; o.c = "c"; return o; }
show("symbol keys", () => JSON.stringify(symbols(20)));
function numbers(n: number) { const o: any = { b: n, 2: "two", a: 1 }; o.later = n; o[1] = "one"; o.last = "l"; return o; }
show("index keys in the literal", () => JSON.stringify(numbers(21)));
function proto(n: number) { const o: any = { a: n, __proto__: { inherited: 1, toJSON: undefined } }; o.later = n; return o; }
show("a prototype in the literal", () => JSON.stringify(proto(22)));
function ownProto(n: number) { const o: any = { a: n, ["__proto__"]: "own" }; o.later = n; return o; }
show("an own __proto__", () => JSON.stringify(ownProto(23)));
class Private { #secret = 1; shown = 2; later?: number; more?: string; read() { return this.#secret; } }
function withPrivate(n: number) { const o = new Private(); if (n & 1) o.more = "m"; o.later = n; return o; }
show("private names", () => JSON.stringify([withPrivate(24), withPrivate(25)]));
function spreadOver(n: number) { const o: any = { ...definedGetter(n), z: 1 }; o.y = 2; return o; }
show("a spread of an object with a getter", () => JSON.stringify(spreadOver(26)));
function assigned(n: number) { const o: any = Object.assign({ a: 1 }, literalGetter(n)); o.y = 2; return o; }
show("assigned from an object with a getter", () => JSON.stringify(assigned(27)));
function undefinedThenSet(n: number) { const o: { a: number; b?: string; c?: number } = { a: n, b: undefined }; o.c = n; if (n & 1) o.b = "set"; return o; }
show("undefined at creation", () => JSON.stringify([undefinedThenSet(28), undefinedThenSet(29)]));
console.log(log.length);
