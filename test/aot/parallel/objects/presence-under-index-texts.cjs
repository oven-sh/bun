// Whether lists and objects with elements have what is asked under the text of an index, under texts that begin with a digit, under symbols and wide texts.
"use strict";
const out = [];
class Holder { constructor(n) { this.n = n; for (let i = 0; i < n; i++) this[i] = i % 2 ? i + 0.5 : { i }; } get own() { return this.n; } }
class List extends Array { get "7up"() { return "getter"; } }
function asks(o, k) { return k in o; }
function owns(o, k) { return Object.hasOwn(o, k); }
function ownsByMethod(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function reflects(o, k) { return Reflect.has(o, k); }
function reads(o, k) { return o[k]; }
function readsFrom(o, k) { return Reflect.get(o, k, o); }
for (const each of [asks, owns, ownsByMethod, reflects, reads, readsFrom, Holder, List]) globalThis["kept" + each.name] = each;
const show = (run) => { try { const v = run(); return typeof v === "object" && v !== null ? JSON.stringify(v) : typeof v === "symbol" ? "symbol" : String(v); } catch (error) { return error.constructor.name; } };
const named = (o, ...names) => { for (const name of names) o[name] = "named " + String(name); return o; };
const digits = Symbol("3");
const makers = [
  () => [1, 2, 3, 4], () => [1, , 3], () => [1.5, , 2.5], () => ["a", "b"], () => [], () => named([1, 2], "1a", "7up", "x"), () => named([1, 2], digits), () => Object.freeze([1, 2]), () => { const a = []; a[5000] = 1; a[3] = 2; return a; },
  () => { const a = [1, 2]; Object.defineProperty(a, 1, { get() { return "got"; } }); return a; }, () => List.of(5, 6), () => named(List.of(5, 6), "2b"), () => Object.setPrototypeOf([, 1], [9, 8, 7]), () => Object.setPrototypeOf([1], null), () => Object.setPrototypeOf([1], named({}, "1a", "3")),
  () => new Holder(0), () => new Holder(5), () => named(new Holder(3), "1a", "x9", digits), () => { const h = new Holder(3); delete h[1]; return h; }, () => ({ 0: "z", 1: "o", "1a": 2, x: 3 }), () => ({}), () => Object.create([1, 2]), () => Object.create(new Holder(2)),
  () => new Uint8Array([1, 2]), () => new Float64Array(3), () => new String("text"), () => (function () { return arguments; })(1, 2), () => new Map(), () => function f(a, b) {}, () => /x/g, () => new Proxy([1, 2, 3], {}), () => new Proxy([1, 2, 3], { has: (o, k) => Reflect.has(o, k), get: (o, k, r) => Reflect.get(o, k, r) }), () => new Proxy(new Holder(2), { has: (o, k) => k === "9" || k in o }),
];
const pieces = (s) => s.split("").join("");
const keys = () => ["0", "1", "2", "3", "7", "10", "4999", "5000", "01", "1a", "1.5", "-1", "-0", "4294967294", "4294967295", "4294967296", "", "x", "7up", "2b", "length", "n", "own", pieces("1"), pieces("10"), String(1), "٠", "〱", "1٠", digits, Symbol.iterator, 0, 1, 3, 1.5, -1];
for (let round = 0; round < 5; round++)
  for (const create of makers) {
    const o = create();
    for (const key of keys()) out.push(show(() => asks(o, key)), show(() => owns(o, key)), show(() => ownsByMethod(o, key)), show(() => reflects(o, key)), show(() => reads(o, key)), show(() => readsFrom(o, key)));
  }
for (const create of makers) {
  const o = create();
  for (const key of keys()) { out.push(show(() => asks(o, key))); try { o[key] = "late"; } catch {} out.push(show(() => asks(o, key)), show(() => owns(o, key)), show(() => reads(o, key))); try { delete o[key]; } catch {} out.push(show(() => asks(o, key)), show(() => owns(o, key)), show(() => reads(o, key))); }
}
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
for (let i = 0; i < out.length; i += 61) console.log(i, out[i].slice(0, 50));
console.log(out.length, hash);
