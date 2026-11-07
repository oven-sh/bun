// `{ ...first, ...second }` in one function, which nothing tells what it is given. Each pair comes many times in turn with the others, with collections in between:
// nothing, primitives, ordinary objects, literals of the program, objects with added names, with getters, symbols, indexes, hidden names, "__proto__" as a name of its own, proxies, lists, functions, frozen objects.
// What comes out is an object of its own with the keys in the order of the language, the values of the second over those of the first, and Object.prototype above it.
function both(first, second) {
  return { ...first, ...second };
}
function bothAndMore(first, second, more) {
  return { ...first, ...second, more, last: 1 };
}
const symbol = Symbol("own");
let reads = 0;
class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  get sum() { return this.x + this.y; }
}
function settings(i) {
  return { delay: 50, stale: 0, mode: "intent", deep: { i }, list: [i], call: () => i, none: undefined, nothing: null, ratio: 0.5 };
}
function parsed(i) {
  return JSON.parse(`{"mode":"render","extra":${i},"z":"z","a":"a"}`);
}
function withAddedNames(i) {
  const o = settings(i);
  o.added = i;
  o["also added"] = -i;
  return o;
}
function withGetter(i) {
  return { before: 1, get mode() { reads++; return "getter" + (i % 2); }, after: 2 };
}
function withHiddenName(i) {
  const o = { shown: i };
  Object.defineProperty(o, "hidden", { value: i, enumerable: false });
  return o;
}
function withOwnProto(i) {
  return JSON.parse(`{"__proto__":{"inherited":${i}},"plain":${i}}`);
}
function wide(i) {
  const o = {};
  for (let k = 0; k < 70; k++) o["k" + k] = i + k;
  return o;
}
const makers = [
  () => undefined, () => null, () => 7, () => true, () => "ab", () => "", () => symbol, () => 10n,
  () => ({}), i => ({ mode: "first", only: i }), settings, parsed, withAddedNames, withGetter, withHiddenName, withOwnProto, wide,
  i => ({ [symbol]: i, mode: "with symbol" }), i => ({ 2: "two", 0: "zero", mode: i % 2 }), i => [i, "x"], i => new Point(i, 1), i => Object.freeze(settings(i)),
  i => Object.create({ inherited: i }, { own: { value: i, enumerable: true } }), i => Object.assign(() => i, { onFunction: i }), i => new Proxy({ viaProxy: i, mode: "proxy" }, {}),
  i => Object.assign(Object.create(null), { bare: i, mode: "bare" }), i => new Map([[i, i]]), i => { const o = settings(i); delete o.stale; return o; }, i => { const o = parsed(i); delete o.z; o.z = "again"; return o; },
];
function describe(o) {
  const keys = Reflect.ownKeys(o);
  const text = keys.map(key => {
    const d = Object.getOwnPropertyDescriptor(o, key);
    const v = d.value;
    return String(key) + "=" + (typeof v === "function" ? "function:" + v() : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)) + (d.writable && d.enumerable && d.configurable ? "" : "!");
  }).join(",");
  return (Object.getPrototypeOf(o) === Object.prototype ? "" : "OTHER PROTOTYPE ") + (text.length > 300 ? keys.length + " keys " + text.slice(0, 120) + " .. " + text.slice(-60) : text);
}
const seen = new Map();
for (let round = 0; round < 6; round++) {
  for (let a = 0; a < makers.length; a++) {
    for (let b = 0; b < makers.length; b++) {
      const first = makers[a](round % 2), second = makers[b](round % 2 + 2);
      const o = both(first, second);
      if (o === first || o === second) console.log("NOT AN OBJECT OF ITS OWN", a, b);
      const line = a + " " + b + " " + round % 2 + ": " + describe(o) + " | " + describe(bothAndMore(first, second, round % 2));
      seen.set(line, (seen.get(line) ?? 0) + 1);
      o.mode = "changed";
      o.later = 1;
      if (first && typeof first === "object" && !(first instanceof Map) && first.later !== undefined) console.log("THE FIRST WAS CHANGED", a, b);
      if (second && typeof second === "object" && second.later !== undefined) console.log("THE SECOND WAS CHANGED", a, b);
    }
  }
  if (round % 2) Bun.gc(true);
}
let hash = 0;
const lines = [...seen].map(([line, count]) => count + " x " + line).sort();
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, "kinds", hash, "getter reads", reads);
for (const line of lines.filter((_, i) => i % 37 === 0)) console.log(line);
// A pair that has come often meets a source whose getter appears late.
const late = settings(3);
for (let i = 0; i < 100; i++) both({ a: 1 }, late);
Object.defineProperty(late, "delay", { get() { reads++; return "late getter"; }, enumerable: true, configurable: true });
console.log(describe(both({ a: 1 }, late)), reads);
