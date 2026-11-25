// Evaluated text reads properties under symbols: own, inherited, absent, accessors, of every kind of object, while objects and the prototypes above them change.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const shared = Symbol("shared"), hiddenKey = Symbol.for("hidden");
class Compiled {
  [shared] = 1;
  get [hiddenKey]() { return "got"; }
  static [shared] = "static";
  *[Symbol.iterator]() { yield 1; yield 2; }
}
class CompiledHeir extends Compiled { [Symbol.toStringTag] = "Heir"; }
const program = { collect: () => globalThis.Bun?.gc?.(true), Compiled, CompiledHeir, shared, hiddenKey, literal: { [shared]: "literal", x: 1 }, vm: require("node:vm") };
const text = `
const lines = [];
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{}" : typeof v === "function" ? "f" : typeof v === "symbol" ? "s" : String(v);
const attempt = (name, f) => { let r; try { r = show(f()); } catch (e) { r = e?.name + (e instanceof TypeError ? "" : ": " + e?.message); } lines.push(name + " " + r); };
const read = (o, k) => o[k];
const { shared, hiddenKey, Compiled, CompiledHeir } = program;
const a = Symbol("a"), b = Symbol("b"), c = Symbol("c"), none = Symbol("none");
const keys = [a, b, c, none, shared, hiddenKey, Symbol.iterator, Symbol.toStringTag, Symbol.hasInstance, Symbol.toPrimitive, Symbol.species, Symbol.asyncIterator, Symbol.isConcatSpreadable, Symbol.unscopables];
class Own { constructor() { this[a] = 1; } get [b]() { return this; } static [c] = 3; }
class Heir extends Own { constructor() { super(); this.x = 1; this[c] = "c"; } }
const frozen = Object.freeze({ [a]: "frozen" });
const makers = [() => ({}), () => ({ [a]: 1 }), () => ({ [a]: undefined, [b]: null }), () => new Own, () => new Heir, () => Own, () => [], () => [1, 2], () => Object.create(null), () => Object.create({ [a]: "above" }), () => Object.create(frozen), () => () => 1, () => function () {}, () => new Map, () => new Set([1]), () => new Uint8Array(2), () => new Date(0), () => /x/, () => new Error("e"), () => new Proxy({ [a]: "in" }, {}), () => new Proxy({}, { get: (t, k) => typeof k }), () => Object("boxed"), () => Object(1), () => Object(a), () => new Compiled, () => new CompiledHeir, () => Compiled, () => CompiledHeir, () => program.literal, () => globalThis, () => Math, () => JSON, () => Promise.resolve(1), () => (function* () {})(), () => (async () => 1)(), () => (function () { return arguments; })(1, 2), () => (function () { "use strict"; return arguments; })(1), () => frozen, () => program.vm.runInNewContext("({})"), () => program.vm.runInNewContext("[1]"), () => new (class extends Array { [a] = "in array"; })(), () => Object.defineProperty({}, a, { get() { return this === undefined ? 0 : "accessor"; }, configurable: true }), () => Object.defineProperty({}, a, { set(v) {} }), () => new Proxy([], {}), () => new WeakMap, () => new ArrayBuffer(1), () => new URL("http://a/")];
const values = ["text", 1, true, 1n, Symbol.iterator, undefined, null];
for (let turn = 0; turn < 5; turn++) {
  for (const [i, make] of makers.entries()) for (let again = 0; again < 3; again++) { const o = make(); attempt("m" + i, () => keys.map(k => { const v = read(o, k); return v === o ? "itself" : v; })); }
  for (const v of values) for (const k of keys) attempt("v", () => read(v, k));
  attempt("strings", () => ["a", "b", Symbol.iterator, "x", a].map(k => [read({ a: 1, [a]: 2, x: 3 }, k), read(new Heir, k), read([1], k)]));
  if (turn === 2) program.collect();
}
attempt("added", () => { const o = new Own, r = []; for (let i = 0; i < 12; i++) { r.push(read(o, c)); if (i === 4) o[c] = "own"; if (i === 8) delete o[c]; } return r; });
attempt("above", () => { const p = {}, o = Object.create(p), r = []; for (let i = 0; i < 20; i++) { r.push(read(o, a)); if (i === 3) p[a] = 1; if (i === 6) p[a] = 2; if (i === 9) delete p[a]; } return r; });
attempt("prototype", () => { const o = { x: 1 }, r = []; for (let i = 0; i < 16; i++) { r.push(read(o, b)); if (i === 4) Object.setPrototypeOf(o, { [b]: "one" }); if (i === 8) Object.setPrototypeOf(o, { y: 1, [b]: "two" }); if (i === 12) Object.setPrototypeOf(o, null); } return r; });
attempt("accessor", () => { let n = 0; const o = { get [a]() { return ++n; } }, r = []; for (let i = 0; i < 10; i++) { r.push(read(o, a)); if (i === 5) Object.defineProperty(o, a, { value: "value" }); } return r; });
attempt("iterators", () => { const l = [1, 2], r = []; for (let i = 0; i < 10; i++) { r.push(read(l, Symbol.iterator) === Array.prototype.values, typeof read(new Map, Symbol.iterator), typeof read("s", Symbol.iterator)); if (i === 4) l[Symbol.iterator] = 5; } return r; });
attempt("many", () => { const l = Array.from({ length: 60 }, (_, i) => ({ ["p" + i]: i, [a]: i, [i % 2 ? b : c]: -i })); let s = 0; for (let i = 0; i < 600; i++) { const o = l[i % 60]; s += read(o, a) + (read(o, b) ?? 0) * 2 + (read(o, c) ?? 0) * 3; } return s; });
attempt("dictionary", () => { const o = {}; for (let i = 0; i < 200; i++) o["k" + i] = i; o[a] = "in"; delete o.k7; const r = []; for (let i = 0; i < 8; i++) { r.push(read(o, a), read(o, b)); if (i === 3) o[b] = 1; } return r; });
attempt("made", () => { let s = 0; for (let i = 0; i < 300; i++) { const k = Symbol(), o = { [k]: i }; s += read(o, k) + (read(o, a) === undefined); if (i % 100 === 99) program.collect(); } return s; });
attempt("compiled", () => { const x = new Compiled, r = []; for (let i = 0; i < 9; i++) { r.push(read(x, shared), read(x, hiddenKey), read(Compiled, shared)); if (i === 3) x[shared] = "two"; if (i === 6) Object.defineProperty(x, hiddenKey, { value: 9 }); } return r; });
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
