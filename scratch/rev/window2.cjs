// Which inputs make the AssertionError constructor exit by a throw while Error.stackTraceLimit is 0.
// Output: JSON { label: "LEAK <thrown>" | "ok <thrown>" }
const assert = require("node:assert");
const before = 10;
class Broken { get href() { throw new Error("boom"); } }
class ThrowingURL extends URL { get href() { throw new Error("url-sub href"); } }
class NameThrows { static get name() { throw new Error("static name"); } }
const fnNameThrows = function () {}; Object.defineProperty(fnNameThrows, "name", { get() { throw new Error("fn name"); } });
class ErrName extends Error { get name() { throw new Error("err name"); } }
class ErrStack extends Error { get stack() { throw new Error("err stack"); } }
class ErrMessage extends Error { get message() { throw new Error("err message"); } }
class ErrErrors extends Error { get errors() { throw new Error("err errors"); } }
class ErrCause extends Error { get cause() { throw new Error("err cause"); } }
function withProxyProto(handler) { class P {} ; Object.setPrototypeOf(P.prototype, new Proxy({}, handler)); return new P(); }
const nullProtoHref = Object.create(null, { href: { get() { throw new Error("null-proto href"); } } });
const AE = assert.AssertionError;
const cases = [
  ["A1 href getter of a non-URL class instance", () => assert.deepStrictEqual({ a: new Broken() }, { a: 1 })],
  ["A2 Object.create(URL.prototype)", () => assert.deepStrictEqual({ a: Object.create(URL.prototype) }, { a: 1 })],
  ["A3 null-prototype object with a href getter", () => assert.deepStrictEqual({ a: nullProtoHref }, { a: 1 })],
  ["A4 class instance, Proxy get('href') trap in its prototype chain", () => assert.deepStrictEqual({ a: withProxyProto({ get(t, k, r) { if (k === "href") throw new Error("proxy get href"); return Reflect.get(t, k, r); } }) }, { a: 1 })],
  ["B1 real URL subclass whose href getter throws", () => assert.deepStrictEqual({ a: new ThrowingURL("http://a/") }, { a: 1 })],
  ["C1 Symbol.toStringTag getter", () => assert.deepStrictEqual({ a: { get [Symbol.toStringTag]() { throw new Error("tag"); } } }, { a: 1 })],
  ["C2 static name getter of the value's class", () => assert.deepStrictEqual({ a: new NameThrows() }, { a: 1 })],
  ["C3 class value with a static name getter", () => assert.deepStrictEqual({ a: NameThrows }, { a: 1 })],
  ["C4 function with a throwing own name getter", () => assert.deepStrictEqual({ a: fnNameThrows }, { a: 1 })],
  ["C5 class instance, Proxy has(Symbol.iterator) trap in its prototype chain", () => assert.deepStrictEqual({ a: withProxyProto({ has() { throw new Error("proxy has"); } }) }, { a: 1 })],
  ["C6 Proxy getOwnPropertyDescriptor trap in the prototype chain", () => assert.deepStrictEqual({ a: Object.create(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("proxy gopd"); } })) }, { a: 1 })],
  ["C7 Proxy getPrototypeOf trap in the prototype chain", () => assert.deepStrictEqual({ a: Object.create(new Proxy({}, { getPrototypeOf() { throw new Error("proxy gpo"); } })) }, { a: 1 })],
  ["C8 Error subclass, name getter", () => assert.deepStrictEqual({ a: new ErrName("x") }, { a: 1 })],
  ["C9 Error subclass, errors getter", () => assert.deepStrictEqual({ a: new ErrErrors("x") }, { a: 1 })],
  ["C10 Error subclass, cause getter", () => assert.deepStrictEqual({ a: new ErrCause("x") }, { a: 1 })],
  ["C11 Error subclass, stack getter", () => assert.deepStrictEqual({ a: new ErrStack("x") }, { a: 1 })],
  ["C12 Error subclass, message getter", () => assert.deepStrictEqual({ a: new ErrMessage("x") }, { a: 1 })],
  ["D1 message object whose toString throws, assert.equal", () => assert.equal(1, 2, { toString() { throw new Error("msg toString"); } })],
  ["D2 message object whose toString throws, new AssertionError", () => new AE({ message: { toString() { throw new Error("msg toString 2"); } } })],
  ["D3 Proxy has('stack') trap on actual, new AssertionError", () => new AE({ actual: new Proxy({}, { has() { throw new Error("has stack"); } }), expected: {}, operator: "deepStrictEqual" })],
  ["D4 copyError, own enumerable getter of an Error, new AssertionError", () => { const e = new Error("x"); Object.defineProperty(e, "p", { enumerable: true, get() { throw new Error("own p"); } }); return new AE({ actual: e, expected: new Error("y"), operator: "deepStrictEqual" }); }],
  ["D5 operator object whose toString throws, new AssertionError", () => new AE({ actual: 1, expected: 2, operator: { toString() { throw new Error("op toString"); } } })],
  ["D6 operator object whose toString throws, assert.fail(a, b, undefined, op)", () => assert.fail(1, 2, undefined, { toString() { throw new Error("op toString 2"); } })],
  ["D7 process.stderr.isTTY getter throws (colors.refresh), plain mismatch", () => { const d = Object.getOwnPropertyDescriptor(process.stderr, "isTTY"); Object.defineProperty(process.stderr, "isTTY", { configurable: true, get() { throw new Error("isTTY"); } }); try { assert.deepStrictEqual({ a: 1 }, { a: 2 }); } finally { if (d) Object.defineProperty(process.stderr, "isTTY", d); else delete process.stderr.isTTY; } }],
  ["Z1 CONTROL own getter throws", () => assert.deepStrictEqual({ get a() { throw new Error("own getter"); } }, { a: 1 })],
  ["Z2 CONTROL plain mismatch", () => assert.deepStrictEqual({ a: 1 }, { a: 2 })],
];
process.removeAllListeners("warning"); process.on("warning", () => {});
let leaks = 0;
for (const [name, f] of cases) {
  Error.stackTraceLimit = before;
  let thrown, did = false;
  try { f(); } catch (e) { thrown = e; did = true; }
  const after = Error.stackTraceLimit;
  Error.stackTraceLimit = before;
  let what;
  try { what = !did ? "no throw" : `${thrown && thrown.name}: ${String(thrown && thrown.message).split("\n")[0].slice(0, 44)}`; } catch (e) { what = "(unprintable)"; }
  if (after !== before) leaks++;
  if (process.argv[2] !== "count") console.log((after === before ? "ok   " : "LEAK ") + name + " | " + what);
}
console.log("LEAK rows: " + leaks + " of " + cases.length);
