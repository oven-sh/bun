// o.hasOwnProperty(key) in loops over objects of every kind, and objects whose method is another.
const keys = ["a", "b", "constructor", "hasOwnProperty", "toString", "0", "1", 0, 1, 2.5, -1, undefined, null, Symbol.iterator, "length", "", "__proto__", true, "x" + 1, 2 ** 32, NaN];
const show = list => list.map(Number).join("");
class P { constructor() { this.a = 1; } get b() { return 2; } static c = 3; #d = 4; has(o) { return #d in o; } }
class Q extends P { constructor() { super(); this.length = 5; } }
function F() { this.a = 1; } F.prototype.b = 2;
const own = { a: 1, hasOwnProperty() { return "mine"; } }, inherited = Object.create({ hasOwnProperty: k => k === "b" }), none = Object.create(null), dictionary = {}; for (let k = 0; k < 100; k++) dictionary["x" + k] = k; delete dictionary.x5;
const trapped = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { return k === "b" ? { value: 1, configurable: true, enumerable: true } : Reflect.getOwnPropertyDescriptor(t, k); } });
const getter = { get hasOwnProperty() { return () => 7; } }, notCallable = { hasOwnProperty: 5 }, frozen = Object.freeze({ a: 1, b: undefined }), accessor = { get a() { throw 1; }, set b(v) { } };
const objects = [{}, { a: 1 }, { a: undefined, b: 1 }, new P(), new Q(), P, F, new F(), [], [1], [, 1], "text", "", 5, true, 10n, Symbol(), () => 0, new Uint8Array(2), new String("ab"), new Map(), Math, JSON, globalThis, own, inherited, dictionary, trapped, getter, frozen, accessor, Object.prototype, Function.prototype, Array.prototype, (function () { return arguments; })(1), new Date(0), /x/, new Error("e")];
function ask(o) { const out = []; for (const key of keys) out.push(o.hasOwnProperty(key)); return out; }
function count(o, list) { return list.filter(key => o.hasOwnProperty(key)).length; }
function without(o, list) { let n = 0; for (let k = 0; k < list.length; k++) if (!o.hasOwnProperty(list[k])) n++; return n; }
function keysOf(o) { const out = []; for (const key in o) if (o.hasOwnProperty(key)) out.push(key); return out; }
function copy(o) { const out = {}; for (const key in o) { if (o.hasOwnProperty(key)) out[key] = 1; } return out; }
let turns = 0;
for (let round = 0; round < 30; round++) {
  const lines = [];
  for (const o of objects) { lines.push(show(ask(o)) + " " + count(o, keys) + " " + without(o, keys) + (o === globalThis ? "" : " " + keysOf(o).length + " " + Object.keys(copy(o)).length)); }
  if (round === 0 || round === 29) console.log(lines.join("\n"));
  turns += lines.length;
}
for (const bad of [none, notCallable, null, undefined]) for (const f of [ask, o => count(o, keys), o => without(o, keys)]) { try { f(bad); console.log("no error"); } catch (error) { console.log(error.name, error.message.slice(0, 60)); } }
const order = []; const key = { toString() { order.push("key"); return "a"; } }, throwing = { toString() { throw new RangeError("stop"); } };
for (let k = 0; k < 3; k++) { order.push({ a: 1 }.hasOwnProperty(key)); try { [1, 2].filter(() => ({}).hasOwnProperty(throwing)); } catch (error) { order.push(error.name); } }
console.log(order.join());
// A property that comes and goes while the loop asks, and a method that comes.
const changing = { a: 1 }; const seen = [];
for (let k = 0; k < 60; k++) { if (k === 20) delete changing.a; if (k === 30) changing.b = 1; if (k === 40) changing.hasOwnProperty = () => "replaced"; if (k === 50) delete changing.hasOwnProperty; seen.push(changing.hasOwnProperty("a"), changing.hasOwnProperty("b")); }
console.log(seen.map(String).join(" ")); console.log(turns);
