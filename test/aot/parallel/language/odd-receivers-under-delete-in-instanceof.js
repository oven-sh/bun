// Odd receivers under delete in has own and instanceof.
let quiet = 0;
let trace = [];
const names = new WeakMap();
function named(v, n) { names.set(v, n); return v; }
function note(s) { if (!quiet) trace.push(s); }
function showKey(k) { return typeof k === "symbol" ? k.toString() : JSON.stringify(k); }
function show(v, depth = 0) {
  switch (typeof v) {
    case "string": return JSON.stringify(v);
    case "number": return Object.is(v, -0) ? "-0" : String(v);
    case "bigint": return v + "n";
    case "symbol": return v.toString();
    case "undefined": return "undefined";
    case "boolean": return String(v);
  }
  if (v === null) return "null";
  if (names.has(v)) return names.get(v);
  if (typeof v === "function") return "function";
  if (depth > 2) return "...";
  quiet++;
  try {
    if (Array.isArray(v)) { const p = []; for (let i = 0; i < Math.min(v.length, 12); i++) p.push(Object.prototype.hasOwnProperty.call(v, i) ? show(v[i], depth + 1) : "<hole>"); const extra = Reflect.ownKeys(v).filter(k => typeof k === "symbol" || (k !== "length" && !/^\d+$/.test(k))).map(showKey); return (Object.getPrototypeOf(v) === Array.prototype ? "" : "^") + "[" + p.join(",") + (v.length > 12 ? ",..#" + v.length : "") + "]" + (extra.length ? "+" + extra.join("+") : "") + (Object.isFrozen(v) ? "F" : Object.isSealed(v) ? "S" : Object.isExtensible(v) ? "" : "X"); }
    if (v instanceof Error) return v.constructor.name + "(" + v.message + ")";
    const tag = Object.prototype.toString.call(v).slice(8, -1);
    const proto = Object.getPrototypeOf(v);
    const protoTag = proto === null ? "^null" : proto === Object.prototype ? "" : typeof proto.constructor === "function" && proto.constructor.prototype === proto ? (proto.constructor.name === tag ? "" : "^" + proto.constructor.name) : "^other";
    const keys = Reflect.ownKeys(v).slice(0, 12);
    return (tag === "Object" ? "" : tag) + protoTag + "{" + keys.map(k => { const d = Reflect.getOwnPropertyDescriptor(v, k); return showKey(k) + ":" + ("value" in d ? show(d.value, depth + 1) : "<accessor>") + (d.enumerable ? "" : "!e") + (d.configurable ? "" : "!c") + ("value" in d && !d.writable ? "!w" : ""); }).join(",") + "}";
  } catch (e) { return "<unshowable " + e.constructor.name + ">"; }
  finally { quiet--; }
}
function attempt(label, f) {
  trace = [];
  let r;
  try { r = "= " + show(f()); } catch (e) { quiet++; try { r = "throws " + (e instanceof Error ? e.constructor.name + (/refuses|^my /.test(e.message) ? ": " + e.message : "") : show(e)); } finally { quiet--; } }
  console.log(label + " " + r + (trace.length ? "  | " + trace.join(" ") : ""));
}
function loggingProxy(target, n) {
  const h = {};
  for (const t of ["get", "set", "has", "deleteProperty", "ownKeys", "getOwnPropertyDescriptor", "defineProperty", "getPrototypeOf", "setPrototypeOf", "isExtensible", "preventExtensions", "apply", "construct"])
    h[t] = function (...a) { note(n + "." + t + (typeof a[1] === "string" || typeof a[1] === "symbol" ? "(" + showKey(a[1]) + ")" : "")); return Reflect[t](...a); };
  return named(new Proxy(target, h), n);
}
function coercible(n, value, how = "valueOf") {
  const o = {};
  if (how === "valueOf") { o.valueOf = function () { note(n + ".valueOf"); return value; }; o.toString = function () { note(n + ".toString"); return String(value); }; }
  else if (how === "toString") { o.valueOf = function () { note(n + ".valueOf"); return {}; }; o.toString = function () { note(n + ".toString"); return value; }; }
  else if (how === "toPrimitive") o[Symbol.toPrimitive] = function (hint) { note(n + ".toPrimitive(" + hint + ")"); return value; };
  else if (how === "throws") o[Symbol.toPrimitive] = function (hint) { note(n + ".toPrimitive(" + hint + ")"); throw new RangeError(n + " refuses"); };
  else if (how === "bad") { o.valueOf = function () { note(n + ".valueOf"); return {}; }; o.toString = function () { note(n + ".toString"); return {}; }; }
  return named(o, n);
}
class Point { constructor(x, y) { this.x = x; this.y = y; } get sum() { note("Point.sum"); return this.x + this.y; } set sum(v) { note("Point.sum=" + show(v)); } norm() { return Math.hypot(this.x, this.y); } }
class Point3 extends Point { z = 3; #w = 4; constructor(x, y) { super(x, y); } get w() { return this.#w; } static has(o) { return #w in o; } }
class List extends Array { get first() { return this[0]; } }
class Bytes extends Uint8Array {}
function detached() { const b = new ArrayBuffer(8); const t = new Uint8Array(b); t[0] = 7; b.transfer(); return t; }
function shrunk() { const b = new ArrayBuffer(8, { maxByteLength: 16 }); const t = new Uint8Array(b, 4, 4); b.resize(2); return t; }
function tracking() { const b = new ArrayBuffer(4, { maxByteLength: 16 }); const t = new Uint8Array(b); t[1] = 9; return t; }
function dictionary() { const o = {}; for (let i = 0; i < 80; i++) o["k" + i] = i; for (let i = 0; i < 78; i++) delete o["k" + i]; o.a = 1; return o; }
const receivers = [
  ["undefined", () => undefined], ["null", () => null], ["true", () => true], ["0", () => 0], ["-0", () => -0], ["NaN", () => NaN], ["1.5", () => 1.5], ["2**31", () => 2 ** 31],
  ["''", () => ""], ["'abc'", () => "abc"], ["astral", () => "\u{1F600}x"], ["rope", () => "ab".repeat(3) + String(quiet)], ["10n", () => 10n], ["symbol", () => Symbol.for("s")],
  ["{}", () => ({})], ["{a,b}", () => ({ a: 1, b: 2 })], ["null-proto", () => Object.create(null)], ["null-proto{a}", () => { const o = Object.create(null); o.a = 1; return o; }],
  ["getter-a", () => ({ get a() { note("get a"); return 5; }, b: 2 })], ["setter-a", () => ({ set a(v) { note("set a " + show(v)); }, b: 2 })],
  ["proto-accessor", () => Object.create({ get a() { note("proto get a"); return 6; }, set a(v) { note("proto set a " + show(v)); } })],
  ["proto-readonly", () => Object.create(Object.freeze({ a: 1, 0: "z" }))],
  ["frozen", () => Object.freeze({ a: 1, b: 2 })], ["sealed", () => Object.seal({ a: 1, b: 2 })], ["inextensible", () => Object.preventExtensions({ a: 1 })],
  ["readonly-a", () => Object.defineProperty({ b: 2 }, "a", { value: 1, writable: false, enumerable: true, configurable: true })],
  ["hidden-a", () => Object.defineProperty({ b: 2 }, "a", { value: 1, writable: true, enumerable: false, configurable: true })],
  ["numeric-keys", () => ({ 2: "two", 0: "zero", a: 1, 1: "one", "-1": "neg", "01": "lead" })], ["symbol-keys", () => ({ [Symbol.for("s")]: 1, a: 1, [Symbol.iterator]: 2 })],
  ["dictionary", dictionary],
  ["[]", () => []], ["[1,2,3]", () => [1, 2, 3]], ["[1.5,2.5]", () => [1.5, 2.5]], ["['a',{}]", () => ["a", named({}, "inner")]], ["holes", () => [1, , 3]], ["double-holes", () => [1.5, , 3.5]],
  ["inherited-elements", () => Object.setPrototypeOf([1, , 3], named({ __proto__: Array.prototype, 1: "inherited", 5: "beyond" }, "element-proto"))],
  ["frozen-array", () => Object.freeze([1, 2, 3])], ["sealed-array", () => Object.seal([1, 2, 3])], ["fixed-length", () => Object.defineProperty([1, 2, 3], "length", { writable: false })],
  ["sparse", () => { const a = [1]; a[100000] = 2; return named(a, "sparse"); }], ["array+named", () => Object.assign([1, 2], { a: 1 })],
  ["getter-element", () => Object.defineProperty([1, 2, 3], 1, { get() { note("get [1]"); return "g"; }, set(v) { note("set [1] " + show(v)); }, enumerable: true, configurable: true })],
  ["List", () => List.from([1, 2, 3])], ["huge-length", () => { const a = []; a.length = 2 ** 32 - 1; return named(a, "huge"); }],
  ["Uint8Array", () => new Uint8Array([1, 2, 3])], ["Float64Array", () => new Float64Array([1.5, NaN, -0])], ["BigInt64Array", () => new BigInt64Array([1n, -1n])], ["empty-typed", () => new Int16Array(0)],
  ["detached", detached], ["shrunk", shrunk], ["tracking", tracking], ["Bytes", () => new Bytes([4, 5])], ["typed+named", () => Object.assign(new Uint8Array(2), { a: 1 })],
  ["DataView", () => new DataView(new ArrayBuffer(4))], ["ArrayBuffer", () => new ArrayBuffer(4)],
  ["mapped-arguments", () => (function (a, b) { return arguments; })(1, 2, 3)], ["strict-arguments", () => (function (a, b) { "use strict"; return arguments; })(1, 2, 3)],
  ["arguments-less", () => (function (a, b) { delete arguments[0]; arguments.length = 5; return arguments; })(1, 2, 3)],
  ["String-object", () => new String("abc")], ["String-object+", () => Object.assign(new String("ab"), { a: 1, 5: "five" })], ["Number-object", () => new Number(3)], ["Boolean-object", () => new Boolean(false)],
  ["Symbol-object", () => Object(Symbol.for("s"))], ["BigInt-object", () => Object(3n)],
  ["function", () => function f(a, b) { return a; }], ["arrow", () => (a) => a], ["class", () => class K { static a = 1; }], ["bound", () => function g(a, b, c) {}.bind(null, 1)], ["async-function", () => async function h() {}],
  ["generator-function", () => function* gen() {}], ["native", () => Math.max], ["method", () => ({ m() {} }).m],
  ["proxy{}", () => loggingProxy({ a: 1, b: 2 }, "P")], ["proxy[]", () => loggingProxy([1, 2, 3], "PA")], ["proxy-fn", () => loggingProxy(function (a) { return a; }, "PF")],
  ["revoked", () => { const r = Proxy.revocable({}, {}); r.revoke(); return named(r.proxy, "revoked"); }],
  ["proto-proxy", () => Object.create(loggingProxy({ a: 1 }, "PP"))],
  ["Map", () => new Map([["a", 1]])], ["Set", () => new Set([1, "a"])], ["WeakMap", () => new WeakMap()], ["Date", () => new Date(0)], ["invalid-Date", () => new Date(NaN)], ["RegExp", () => /a(b)?/g], ["Error", () => new TypeError("boom")],
  ["Promise", () => named(Promise.resolve(1), "promise")], ["generator", () => (function* () { yield 1; yield 2; })()], ["array-iterator", () => [1, 2][Symbol.iterator]()],
  ["Math", () => named(Math, "Math")], ["JSON", () => named(JSON, "JSON")],
  ["Point", () => new Point(1, 2)], ["Point3", () => new Point3(1, 2)],
  ["Point-deleted", () => { const p = new Point(1, 2); delete p.x; return p; }], ["Point-readded", () => { const p = new Point(1, 2); delete p.x; p.x = 9; return p; }],
  ["Point-accessor", () => Object.defineProperty(new Point(1, 2), "x", { get() { note("get x"); return 7; }, set(v) { note("set x " + show(v)); }, enumerable: true, configurable: true })],
  ["Point-frozen", () => Object.freeze(new Point(1, 2))], ["Point-sealed", () => Object.seal(new Point(1, 2))], ["Point-reproto", () => Object.setPrototypeOf(new Point(1, 2), { a: "other" })],
  ["Point-null-proto", () => Object.setPrototypeOf(new Point(1, 2), null)], ["Point-grown", () => { const p = new Point(1, 2); for (let i = 0; i < 70; i++) p["g" + i] = i; return named(p, "grown"); }],
  ["Point-indexed", () => { const p = new Point(1, 2); p[0] = "i0"; p[2] = "i2"; return p; }], ["Point-a", () => Object.assign(new Point(1, 2), { a: "own a" })],
];
const keys = [["'a'", () => "a"], ["'x'", () => "x"], ["'length'", () => "length"], ["0", () => 0], ["1", () => 1], ["'1'", () => "1"], ["5", () => 5], ["-1", () => -1], ["-0", () => -0], ["1.5", () => 1.5], ["'-0'", () => "-0"], ["NaN", () => NaN], ["2**32-1", () => 2 ** 32 - 1], ["sym", () => Symbol.for("s")], ["iterator", () => Symbol.iterator], ["'__proto__'", () => "__proto__"], ["'name'", () => "name"], ["'prototype'", () => "prototype"], ["key-object", () => coercible("K", "a", "toString")], ["key-throws", () => coercible("K", 1, "throws")], ["null", () => null], ["undefined", () => undefined]];
function after(r) { return typeof r === "object" && r !== null || typeof r === "function" ? r : "primitive"; }
function sloppyDeleteA(r) { return [delete r.a, after(r)]; }
function strictDeleteA(r) { "use strict"; return [delete r.a, after(r)]; }
function strictDeleteX(r) { "use strict"; return [delete r.x, after(r)]; }
function strictDeleteLength(r) { "use strict"; return [delete r.length, after(r)]; }
function sloppyDelete(r, k) { return [delete r[k], after(r)]; }
function strictDelete(r, k) { "use strict"; return [delete r[k], after(r)]; }
for (const [rn, make] of receivers) {
  attempt("delete " + rn + ".a sloppy", () => sloppyDeleteA(make()));
  attempt("delete " + rn + ".a strict", () => strictDeleteA(make()));
  attempt("delete " + rn + ".x strict", () => strictDeleteX(make()));
  attempt("delete " + rn + ".length strict", () => strictDeleteLength(make()));
  attempt("'a' in " + rn, () => "a" in make());
  attempt("'x' in " + rn, () => "x" in make());
  attempt("'length' in " + rn, () => "length" in make());
  attempt("0 in " + rn, () => 0 in make());
  attempt("typeof " + rn, () => typeof make());
  attempt("#w in " + rn, () => Point3.has(make()));
  for (const [kn, key] of keys) {
    attempt("delete " + rn + "[" + kn + "] sloppy", () => sloppyDelete(make(), key()));
    attempt("delete " + rn + "[" + kn + "] strict", () => strictDelete(make(), key()));
    attempt(kn + " in " + rn, () => key() in make());
    attempt("hasOwn " + rn + " " + kn, () => Object.hasOwn(make(), key()));
    attempt("hasOwnProperty " + rn + " " + kn, () => Object.prototype.hasOwnProperty.call(make(), key()));
    attempt("propertyIsEnumerable " + rn + " " + kn, () => Object.prototype.propertyIsEnumerable.call(make(), key()));
  }
}
const rights = [["Object", () => Object], ["Array", () => Array], ["Function", () => Function], ["Point", () => Point], ["Point3", () => Point3], ["List", () => List], ["Uint8Array", () => Uint8Array], ["String", () => String], ["bound-Point", () => Point.bind(null)], ["arrow", () => () => 1], ["proxy-Point", () => loggingProxy(Point, "PPoint")], ["hasInstance", () => ({ [Symbol.hasInstance](v) { note("hasInstance"); return 1; } })], ["hasInstance-getter", () => ({ get [Symbol.hasInstance]() { note("get hasInstance"); return undefined; } })],
  ["odd-prototype", () => { function F() {} F.prototype = 3; return F; }], ["getter-prototype", () => { const f = function () {}.bind(); Object.defineProperty(f, "prototype", { get() { note("get prototype"); return Point.prototype; } }); return f; }], ["{}", () => ({})], ["null", () => null], ["1", () => 1], ["Error", () => Error], ["Promise", () => Promise], ["Map", () => Map], ["static-hasInstance", () => class { static [Symbol.hasInstance](v) { note("static hasInstance"); return v === 0; } }]];
for (const [rn, make] of receivers) for (const [cn, right] of rights) attempt(rn + " instanceof " + cn, () => make() instanceof right());
