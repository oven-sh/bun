// Operations on odd receivers run user code in order.
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
// Each probe reads state.x, runs one operation that may run the program's own code, and reads state.x again.
class State { constructor() { this.x = 1; this.list = [1, 2, 3]; this.map = new Map([["k", 1]]); } }
let shared = new State();
let counter = 0;
function touch() { shared.x++; shared.list.push(shared.list.length); shared.list[0]++; shared.map.set("k", shared.map.get("k") + 1); counter++; }
function report(name, f, normal, odd) {
  for (let i = 0; i < 60; i++) { shared = new State(); counter = 0; try { f(shared, normal()); } catch {} }
  shared = new State(); counter = 0;
  attempt(name, () => f(shared, odd()));
}
function around(s, run) {
  const x0 = s.x, n0 = s.list.length, e0 = s.list[0], m0 = s.map.get("k"), c0 = counter;
  const r = run();
  return [x0, s.x, n0, s.list.length, e0, s.list[0], m0, s.map.get("k"), c0, counter, r];
}
const toucher = (v, how = "toString") => ({ [how]() { touch(); return v; } });

report("for-in read of an accessor on a class instance", (s, o) => { const r = []; for (const k in o) { const x0 = s.x, e0 = s.list[0], c0 = counter; const v = o[k]; r.push(k, x0, s.x, e0, s.list[0], c0, counter, v); } return r; }, () => new Point(1, 2), () => Object.defineProperty(new Point(1, 2), "y", { get() { touch(); return "got"; }, enumerable: true, configurable: true }));
report("for-in read of an accessor on a literal", (s, o) => { const r = []; for (const k in o) { const x0 = s.x, c0 = counter; const v = o[k]; r.push(k, x0, s.x, c0, counter, v); } return r; }, () => ({ p: 1, q: 2 }), () => ({ p: 1, get q() { touch(); return "got"; } }));
report("for-in read through a proxy", (s, o) => { const r = []; for (const k in o) { const x0 = s.x; const v = o[k]; r.push(k, x0, s.x, v); } return r; }, () => ({ p: 1, q: 2 }), () => new Proxy({ p: 1, q: 2 }, { get(t, k) { touch(); return t[k]; } }));
report("for-in, a getter deletes the next key", (s, o) => { const r = []; for (const k in o) r.push(k, o[k]); return r; }, () => ({ p: 1, q: 2, r: 3 }), () => ({ get p() { delete this.q; return "p"; }, q: 2, r: 3 }));
report("for-in, the body turns a field into an accessor", (s, o) => { const r = []; for (const k in o) { if (k === "x") Object.defineProperty(o, "y", { get() { touch(); return "late"; }, enumerable: true, configurable: true }); const x0 = s.x; const v = o[k]; r.push(k, x0, s.x, v); } return r; }, () => new Point(1, 2), () => new Point(1, 2));
report("push with a setter on the array's own prototype", (s, a) => around(s, () => a.push(5)), () => [1, 2], () => Object.setPrototypeOf([1, 2], Object.defineProperty({ __proto__: Array.prototype }, 2, { set(v) { touch(); }, get() { return "g"; } })));
report("push number with a setter on the prototype", (s, a) => around(s, () => a.push(5.5)), () => [1.5, 2.5], () => Object.setPrototypeOf([1.5, 2.5], Object.defineProperty({ __proto__: Array.prototype }, 2, { set(v) { touch(); }, get() { return "g"; } })));
report("a[a.length] = v with a setter on the prototype", (s, a) => around(s, () => { a[a.length] = 5; return a.length; }), () => [1, 2], () => Object.setPrototypeOf([1, 2], Object.defineProperty({ __proto__: Array.prototype }, 2, { set(v) { touch(); }, get() { return "g"; } })));
report("spread of holes with a getter on the prototype", (s, a) => around(s, () => [0, ...a, 9]), () => [1, 2, 3], () => Object.setPrototypeOf([1, , 3], Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { touch(); return "g"; } })));
report("two spreads of holes with a getter", (s, a) => around(s, () => [...a, ...a]), () => [1, 2, 3], () => Object.setPrototypeOf([1, , 3], Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { touch(); return "g"; } })));
report("a getter shrinks the array that is spread", (s, a) => around(s, () => [...a]), () => [1, 2, 3, 4], () => { const a = [1, , 3, 4]; return Object.setPrototypeOf(a, Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { a.length = 2; return "g"; } })); });
report("a getter grows the array that is spread", (s, a) => around(s, () => [...a]), () => [1, 2, 3], () => { const a = [1, , 3]; return Object.setPrototypeOf(a, Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { if (a.length < 6) a.push("more"); return "g"; } })); });
report("join of objects", (s, a) => around(s, () => a.join("-")), () => ["a", "b"], () => ["a", toucher("t")]);
report("join with holes and a getter", (s, a) => around(s, () => a.join("-")), () => ["a", "b", "c"], () => Object.setPrototypeOf(["a", , "c"], Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { touch(); return "g"; } })));
report("join with a separator object", (s, a) => around(s, () => a[0].join(a[1])), () => [["a", "b"], "-"], () => [["a", "b"], toucher("+")]);
report("template of an object", (s, o) => around(s, () => `<${o}>`), () => "text", () => toucher("t"));
report("template of three", (s, o) => around(s, () => `${s.x}${o}${s.x}`), () => "text", () => toucher("t"));
report("template with valueOf and toString", (s, o) => around(s, () => `${o}`), () => 5, () => ({ valueOf() { touch(); return "v"; }, toString() { touch(); touch(); return "s"; } }));
report("concatenation of an object", (s, o) => around(s, () => "<" + o + ">"), () => "text", () => toucher("t", "valueOf"));
report("concatenation in order", (s, o) => around(s, () => s.x + "," + o + "," + s.x), () => "text", () => toucher("t", "valueOf"));
report("+= in a loop", (s, o) => around(s, () => { let t = ""; for (let i = 0; i < 3; i++) t += o; return t + s.x; }), () => "ab", () => toucher("t", "valueOf"));
report("template of a symbol", (s, o) => around(s, () => `${o}`), () => "text", () => Symbol("no"));
report("new Set of an array with its own iterator", (s, a) => around(s, () => [...new Set(a)]), () => [1, 2], () => Object.assign([1, 2], { [Symbol.iterator]() { touch(); return [7][Symbol.iterator](); } }));
report("new Set of holes with a getter", (s, a) => around(s, () => [...new Set(a)]), () => [1, 2, 3], () => Object.setPrototypeOf([1, , 3], Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { touch(); return "g"; } })));
report("new Map of entries with getters", (s, a) => around(s, () => [...new Map(a)]), () => [["a", 1]], () => [["a", 1], { get 0() { touch(); return "k"; }, get 1() { touch(); return "v"; } }]);
report("new Map of entries that are proxies", (s, a) => around(s, () => [...new Map(a)]), () => [["a", 1]], () => [new Proxy(["k", "v"], { get(t, k) { touch(); return t[k]; } })]);
report("new Map of an entry that is no object", (s, a) => around(s, () => [...new Map(a)]), () => [["a", 1]], () => [["a", 1], "xy"]);
report("new Map of entries with holes and a getter", (s, a) => around(s, () => [...new Map(a)]), () => [["a", 1]], () => [Object.setPrototypeOf(["k", ,], Object.defineProperty({ __proto__: Array.prototype }, 1, { get() { touch(); return "g"; } }))]);
report("JSON.stringify with toJSON", (s, o) => around(s, () => JSON.stringify(o)), () => ({ a: 1, b: { c: 2 } }), () => ({ a: 1, b: { toJSON() { touch(); return "j"; } } }));
report("JSON.stringify of a class instance with toJSON inside", (s, o) => around(s, () => JSON.stringify(o)), () => new Point(1, 2), () => new Point(1, { toJSON() { touch(); return "j"; } }));
report("JSON.stringify with a getter", (s, o) => around(s, () => JSON.stringify(o)), () => ({ a: 1, b: 2 }), () => ({ a: 1, get b() { touch(); return "g"; } }));
report("JSON.stringify of a Date with its own toISOString", (s, o) => around(s, () => JSON.stringify({ d: o })), () => new Date(0), () => Object.assign(new Date(0), { toISOString() { touch(); return "mine"; } }));
report("JSON.stringify of an invalid Date", (s, o) => around(s, () => JSON.stringify({ d: o })), () => new Date(0), () => new Date(NaN));
report("JSON.stringify of a boxed number with valueOf", (s, o) => around(s, () => JSON.stringify({ d: o })), () => 5, () => Object.assign(new Number(5), { valueOf() { touch(); return 6; } }));
report("JSON.stringify of a boxed string with toString", (s, o) => around(s, () => JSON.stringify({ d: o })), () => "5", () => Object.assign(new String("5"), { toString() { touch(); return "six"; } }));
report("regexp flags with an own getter", (s, r) => around(s, () => r.flags), () => /a/g, () => Object.defineProperty(/a/g, "global", { get() { touch(); return false; } }));
report("regexp source with an own property", (s, r) => around(s, () => r.source), () => /a/g, () => Object.defineProperty(/a/g, "source", { get() { touch(); return "mine"; } }));
report("regexp test with lastIndex object", (s, r) => around(s, () => r.test("aaa")), () => /a/g, () => Object.assign(/a/g, { lastIndex: { valueOf() { touch(); return 1; } } }));
report("regexp exec with lastIndex object", (s, r) => around(s, () => r.exec("aaa").index), () => /a/y, () => Object.assign(/a/y, { lastIndex: { valueOf() { touch(); return 1; } } }));
report("regexp with own exec", (s, r) => around(s, () => r.test("aaa")), () => /a/, () => Object.assign(/a/, { exec() { touch(); return null; } }));
report("replace with a regexp with own exec", (s, r) => around(s, () => "aaa".replace(r, "b")), () => /a/, () => Object.assign(/a/, { exec() { touch(); return null; } }));
report("replace with lastIndex object", (s, r) => around(s, () => "aaa".replace(r, "b")), () => /a/y, () => Object.assign(/a/y, { lastIndex: { valueOf() { touch(); return 1; } } }));
report("replace with a replacement object", (s, r) => around(s, () => "aaa".replace("a", r)), () => "b", () => toucher("t"));
report("replace with a search object", (s, r) => around(s, () => "aaa".replace(r, "b")), () => "a", () => ({ [Symbol.replace](t, v) { touch(); return "mine"; } }));
report("split with a separator object", (s, r) => around(s, () => "a,b".split(r)), () => ",", () => ({ [Symbol.split](t, v) { touch(); return "mine"; } }));
report("split with a limit object", (s, r) => around(s, () => "a,b".split(",", r)), () => 5, () => toucher(1, "valueOf"));
report("toISOString of an invalid date", (s, d) => around(s, () => d.toISOString()), () => new Date(0), () => new Date(NaN));
report("toISOString far away", (s, d) => around(s, () => d.toISOString()), () => new Date(0), () => new Date(8.64e15));
report("toISOString before year 0", (s, d) => around(s, () => d.toISOString()), () => new Date(0), () => new Date(-62198755200000));
report("Intl.DateTimeFormat format NaN", (s, d) => around(s, () => new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(d)), () => new Date(0), () => new Date(NaN));
report("Intl.DateTimeFormat format object", (s, d) => around(s, () => new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(d)), () => 0, () => toucher(0, "valueOf"));
report("Intl.NumberFormat format object", (s, d) => around(s, () => new Intl.NumberFormat("en-US").format(d)), () => 1234.5, () => toucher(7, "valueOf"));
report("Intl.NumberFormat format bigint and text", (s, d) => around(s, () => [new Intl.NumberFormat("en-US").format(d), new Intl.NumberFormat("en-US").format(String(d))]), () => 1234.5, () => 12345678901234567890n);
report("Object.create of a proxy", (s, p) => around(s, () => Object.getPrototypeOf(Object.create(p)) === p), () => ({}), () => new Proxy({}, { getPrototypeOf() { touch(); return null; } }));
report("strict equality of ropes", (s, p) => around(s, () => p === "abab0"), () => "abab0", () => "ab".repeat(2) + quiet);
report("number toString with a radix object", (s, p) => around(s, () => (255).toString(p)), () => 16, () => toucher(2, "valueOf"));
report("number toString with a bad radix", (s, p) => around(s, () => (255).toString(p)), () => 16, () => 1);
report("number toString with radix 37", (s, p) => around(s, () => (255.5).toString(p)), () => 16, () => 37);
report("toFixed with an object", (s, p) => around(s, () => (1.255).toFixed(p)), () => 2, () => toucher(1, "valueOf"));
report("Map.get with an object key", (s, p) => around(s, () => s.map.get(p)), () => "k", () => toucher("k"));
report("typed array store of an object out of bounds", (s, p) => around(s, () => { const t = new Uint8Array(2); t[5] = p; return t; }), () => 1, () => toucher(1, "valueOf"));
report("typed array store detaches", (s, p) => around(s, () => { const t = new Uint8Array(2); t[0] = p(t); return t.length; }), () => () => 1, () => t => ({ valueOf() { touch(); t.buffer.transfer(); return 1; } }));
report("typed array fill with an object", (s, p) => around(s, () => new Uint8Array(2).fill(p)), () => 1, () => toucher(1, "valueOf"));
report("Math.max coerces all", (s, p) => around(s, () => Math.max(NaN, p, p)), () => 1, () => toucher(1, "valueOf"));
report("Math.hypot coerces all", (s, p) => around(s, () => Math.hypot(Infinity, p, p)), () => 1, () => toucher(1, "valueOf"));
report("Math.atan2 order", (s, p) => around(s, () => Math.atan2(p, p)), () => 1, () => toucher(1, "valueOf"));
report("parseInt of an object", (s, p) => around(s, () => parseInt(p, p)), () => "10", () => toucher("10"));
report("String.fromCharCode of an object", (s, p) => around(s, () => String.fromCharCode(p, p)), () => 65, () => toucher(66, "valueOf"));
report("charCodeAt of an object", (s, p) => around(s, () => "abc".charCodeAt(p)), () => 1, () => toucher(2, "valueOf"));
report("substring of objects", (s, p) => around(s, () => "abcdef".substring(p, p)), () => 1, () => toucher(2, "valueOf"));
report("padStart of objects", (s, p) => around(s, () => "a".padStart(p[0], p[1])), () => [3, "x"], () => [toucher(3, "valueOf"), toucher("y")]);
report("padStart needs no filler", (s, p) => around(s, () => "abc".padStart(p[0], p[1])), () => [3, "x"], () => [toucher(1, "valueOf"), toucher("y")]);
report("repeat of an object", (s, p) => around(s, () => "a".repeat(p)), () => 2, () => toucher(3, "valueOf"));
report("indexOf of objects", (s, p) => around(s, () => "abcabc".indexOf(p[0], p[1])), () => ["b", 2], () => [toucher("b"), toucher(2, "valueOf")]);
report("startsWith of a regexp-like", (s, p) => around(s, () => "abc".startsWith(p)), () => "a", () => ({ get [Symbol.match]() { touch(); return false; }, toString() { touch(); return "a"; } }));
report("localeCompare of an object", (s, p) => around(s, () => "a".localeCompare(p)), () => "b", () => toucher("b"));
report("instanceof with a prototype getter on a bound function", (s, p) => around(s, () => ({}) instanceof p), () => Point, () => new Proxy(Point, { get(t, k) { touch(); return t[k]; } }));
report("in with a proxy", (s, p) => around(s, () => "x" in p), () => new Point(1, 2), () => new Proxy({}, { has() { touch(); return true; } }));
report("in through a prototype proxy", (s, p) => around(s, () => "zzz" in p), () => new Point(1, 2), () => Object.setPrototypeOf(new Point(1, 2), new Proxy({}, { has() { touch(); return true; } })));
report("read through a prototype proxy", (s, p) => around(s, () => p.zzz), () => new Point(1, 2), () => Object.setPrototypeOf(new Point(1, 2), new Proxy({}, { get() { touch(); return "via"; } })));
report("write through a prototype proxy", (s, p) => around(s, () => { p.zzz = 1; return Object.keys(p); }), () => new Point(1, 2), () => Object.setPrototypeOf(new Point(1, 2), new Proxy({}, { set() { touch(); return true; } })));
report("spread of a class instance with an accessor", (s, p) => around(s, () => ({ ...p })), () => new Point(1, 2), () => Object.defineProperty(new Point(1, 2), "x", { get() { touch(); return "g"; }, enumerable: true, configurable: true }));
report("Object.assign onto a setter", (s, p) => around(s, () => Object.assign(p, { x: 5 })), () => new Point(1, 2), () => Object.defineProperty(new Point(1, 2), "x", { set(v) { touch(); }, enumerable: true, configurable: true }));
report("Object.keys of a proxy", (s, p) => around(s, () => Object.keys(p)), () => new Point(1, 2), () => new Proxy({ a: 1 }, { ownKeys(t) { touch(); return Reflect.ownKeys(t); } }));
report("Object.entries with a getter that deletes", (s, p) => around(s, () => Object.entries(p)), () => ({ a: 1, b: 2 }), () => ({ get a() { touch(); delete this.b; return 1; }, b: 2 }));
report("Object.values with a getter that adds", (s, p) => around(s, () => Object.values(p)), () => ({ a: 1, b: 2 }), () => ({ get a() { touch(); this.c = 3; return 1; }, b: 2 }));
report("array destructuring with defaults", (s, p) => around(s, () => { const [a = (touch(), "da"), b = (touch(), "db")] = p; return [a, b]; }), () => [1, 2], () => ({ [Symbol.iterator]() { let i = 0; return { next() { note("next"); touch(); return { done: i++ > 5, value: undefined }; }, return() { note("return"); touch(); return {}; } }; } }));
report("array destructuring into members", (s, p) => around(s, () => { const o = { set a(v) { note("set a"); }, set b(v) { note("set b"); } }; [o.a, o.b] = p; return 0; }), () => [1, 2], () => ({ [Symbol.iterator]() { return { next() { note("next"); return { done: false, value: 1 }; }, return() { note("return"); return {}; } }; } }));
report("array destructuring, a default throws", (s, p) => around(s, () => { const [a, b = (() => { throw new RangeError("my default"); })()] = p; return [a, b]; }), () => [1, 2], () => ({ [Symbol.iterator]() { return { next() { note("next"); return { done: false, value: undefined }; }, return() { note("return"); return {}; } }; } }));
