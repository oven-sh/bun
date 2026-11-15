// Elements by index and properties by name, read off objects that nobody knows: instances with elements of each kind, lists, texts, views, arguments, proxies.
"use strict";
const out = [];
class Plain { constructor(a) { this.a = a; } }
class Holder { constructor(n) { this.n = n; for (let i = 0; i < n; i++) this[i] = { at: i }; } }
class Ints { constructor(n) { this.n = n; for (let i = 0; i < n; i++) this[i] = i * 3; } }
class Doubles { constructor(n) { this.n = n; for (let i = 0; i < n; i++) this[i] = i + 0.5; } }
class List extends Array { get half() { return this.length / 2; } }
class Late { constructor() { this.kind = "late"; } get sum() { return this.x + this.y; } }
function element(o, i) { return o[i]; }
function store(o, i, v) { o[i] = v; return o[i]; }
function named(o) { return o.late; }
function other(o) { return o.far; }
function computed(o) { return o.sum; }
function lacking(o) { return o.nowhere; }
for (const each of [element, store, named, other, computed, lacking, Plain, Holder, Ints, Doubles, List, Late]) globalThis["kept" + each.name] = each;
const show = (run) => { try { const v = run(); return typeof v === "object" && v !== null ? JSON.stringify(v) : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : String(v) + (typeof v === "bigint" ? "n" : ""); } catch (error) { return error.constructor.name; } };
const many = (o, n) => { for (let i = 0; i < n; i++) o["p" + i] = i; return o; };
const args = (function () { return arguments; })(1, "two", { three: 3 });
const sloppy = Function("a", "b", "b = 9; arguments[0] = 7; return arguments")(1, 2);
const overridden = (function () { arguments[1] = "over"; arguments.length = 1; return arguments; })(1, 2, 3);
const makers = [
  () => [1, 2, 3, 4, 5, 6], () => [1.5, 2.5, -0, NaN, 5.5, 6.5], () => ["a", {}, null, undefined, true, 7n], () => [1, , 3, , 5], () => [, 1.5, , 2.5], () => { const a = []; a[100000] = 1; a[2] = "two"; return a; },
  () => [], () => new Array(6), () => Object.freeze([1, 2, 3]), () => List.from([1, 2, 3, 4]), () => { const l = new List(); l.push({ a: 1 }, 2.5); return l; },
  () => "letters", () => "Жж wide", () => "le" + "tters of a rope that is long enough ".repeat(2), () => "a part of a text that is long".slice(3, 20), () => "", () => "\xe9\xff",
  () => new Int8Array([1, -2, 3]), () => new Uint8Array([1, 200, 3]), () => new Uint8ClampedArray([300, 2]), () => new Int16Array([1, -2]), () => new Uint16Array([65535]), () => new Int32Array([1, -2, 3]), () => new Uint32Array([4294967295, 2]),
  () => new Float32Array([1.5, NaN]), () => new Float64Array([1.5, -0]), () => new BigInt64Array([5n]), () => new BigUint64Array([6n]), () => new DataView(new ArrayBuffer(8)), () => new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 })),
  () => new Holder(0), () => new Holder(1), () => new Holder(6), () => new Ints(6), () => new Doubles(6), () => { const d = new Doubles(4); delete d[1]; return d; }, () => { const h = new Holder(3); h[7] = "far"; return h; }, () => { const i = new Ints(3); i[1] = "mixed"; return i; },
  () => { const h = new Holder(3); h[1000000] = "sparse"; return h; }, () => { const h = new Holder(3); Object.defineProperty(h, 1, { get() { return "got " + this.n; } }); return h; }, () => Object.freeze(new Holder(3)), () => { const p = new Plain(1); p[-1] = "minus"; p[2] = "two"; return p; },
  () => new Plain(2), () => ({ 0: "zero", 1: "one", a: 1 }), () => ({}), () => Object.create(null), () => Object.create([7, 8, 9]), () => Object.setPrototypeOf(new Plain(3), [7, 8, 9]),
  () => args, () => sloppy, () => overridden, () => new Proxy([1, 2, 3], {}), () => new Proxy(new Holder(3), { get: (o, k) => typeof k === "string" ? "trap " + k : undefined }), () => function named(a) {}, () => new Map([[0, 1]]), () => /x/, () => new Date(0), () => new Error("e"),
  () => 5, () => 1.5, () => true, () => null, () => undefined, () => Symbol.iterator, () => 9n,
  () => Object.assign(new Late(), { x: 1, y: 2, late: "late value" }), () => many(Object.assign(new Late(), { late: { deep: 1 } }), 9), () => many(Object.assign(new Late(), { x: 2.5, y: 3 }), 3), () => { const l = many(new Late(), 7); l.late = 5; l.far = "far"; return l; },
  () => { const l = many(new Late(), 4); l.far = 1; delete l.p0; l.late = null; return l; }, () => Object.defineProperty(many(new Late(), 2), "late", { get() { return "got " + this.kind; } }), () => Object.freeze(Object.assign(new Late(), { late: 8 })),
  () => Object.create(Object.assign(new Late(), { late: "inherited", far: 6, x: 1, y: 1 })), () => Object.create(many({ late: "above", far: "above" }, 8)), () => Object.assign(Object.create({ get late() { return "getter above"; }, get sum() { return "sum above"; } }), { far: 3 }),
];
const keys = [0, 1, 2, 5, 6, -1, 100000, 1000000, 2147483647, 4294967295, 1.5, -0, "1", "p1", "length", "late"];
for (let round = 0; round < 4; round++)
  for (const create of makers) {
    const o = create();
    for (const key of keys) out.push(show(() => element(o, key)));
    for (const read of [named, other, computed, lacking]) for (let again = 0; again < 3; again++) out.push(show(() => read(o)));
  }
for (const create of makers) for (const key of [0, 1, 3, 7, 40, 100000]) for (const value of [1, 2.5, "text", { a: 1 }, undefined]) { const o = create(); out.push(show(() => store(o, key, value)), show(() => element(o, key))); if (typeof o === "object" && o !== null) out.push(show(() => element(o, key + 1))); }
const grown = new Holder(0);
for (let i = 0; i < 90; i++) { out.push(show(() => store(grown, i, i % 7 ? i : { i }))); out.push(show(() => element(grown, i))); }
Object.defineProperty(Late.prototype, "late", { get() { return "late getter"; }, configurable: true });
for (const create of makers) { let o; try { o = create(); } catch (error) { o = error.constructor.name; } for (const read of [named, other, computed, lacking]) for (let again = 0; again < 3; again++) out.push(show(() => read(o))); }
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
for (let i = 0; i < out.length; i += 37) console.log(i, out[i].slice(0, 60));
console.log(out.length, hash);
