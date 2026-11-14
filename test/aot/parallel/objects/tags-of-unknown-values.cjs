// Object.prototype.toString.call of values of every kind in loops, and tags that come and go.
const toString = Object.prototype.toString, tag = value => Object.prototype.toString.call(value), held = { toString: Object.prototype.toString };
class A { get [Symbol.toStringTag]() { return "FromGetter"; } } class B { } B.prototype[Symbol.toStringTag] = "FromPrototype"; class C extends B { }
const own = { [Symbol.toStringTag]: "Own" }, notText = { [Symbol.toStringTag]: 5 }, none = Object.create(null), inherited = Object.create(own), throwing = { get [Symbol.toStringTag]() { throw new RangeError("stop"); } };
const values = [undefined, null, true, 0, -0, 1.5, NaN, "", "text", 10n, Symbol("s"), Symbol.iterator, {}, { a: 1 }, [], [1], () => 0, function () { }, class { }, async () => 0, function* () { }, async function* () { }, /x/, new Date(0), new Error("e"), new TypeError("t"), new Map(), new Set(), new WeakMap(), new WeakSet(), Promise.resolve(), new ArrayBuffer(2), new Uint8Array(2), new DataView(new ArrayBuffer(2)), new String("s"), new Number(1), new Boolean(true), Object(1n), Object(Symbol()), Math, JSON, Reflect, Atomics, globalThis, (function () { return arguments; })(1), new A(), new B(), new C(), own, notText, none, inherited, new Proxy({}, {}), new Proxy([], {}), new Proxy(() => 0, {}), new Proxy(own, {}), Object.prototype, Function.prototype, Array.prototype, new Map().entries(), [][Symbol.iterator](), "x"[Symbol.iterator](), (function* () { })(), new WeakRef({}), new Intl.NumberFormat("en"), Buffer.from("x"), new URL("http://a/"), process];
function tags(list) { const out = []; for (let k = 0; k < list.length; k++) out.push(Object.prototype.toString.call(list[k])); return out; }
function tagsByName(list) { const out = []; for (const value of list) out.push(toString.call(value)); return out; }
function tagsByHelper(list) { const out = []; for (const value of list) out.push(tag(value)); return out; }
function count(list, text) { let n = 0; for (let k = 0; k < list.length; k++) if (toString.call(list[k]) === text) n++; return n; }
let turns = 0;
for (let round = 0; round < 40; round++) {
  const a = tags(values), b = tagsByName(values), c = tagsByHelper(values), d = values.map(value => held.toString.call(value));
  turns += a.length; if (round === 0 || round === 39) console.log(a.join(" ")); if (a.join() !== b.join() || a.join() !== c.join() || a.join() !== d.join()) console.log("differ", round);
  if (round % 10 === 0) console.log(count(values, "[object Object]"), count(values, "[object Array]"), count(values, "[object Function]"), count(values, "[object Date]"));
}
// Tags that change while a loop asks.
const changing = { a: 1 }, array = [1], date = new Date(0), instance = new C(), seen = [];
for (let k = 0; k < 90; k++) {
  if (k === 10) changing[Symbol.toStringTag] = "Now"; if (k === 20) changing[Symbol.toStringTag] = "Then"; if (k === 30) delete changing[Symbol.toStringTag]; if (k === 40) B.prototype[Symbol.toStringTag] = "Changed"; if (k === 50) delete B.prototype[Symbol.toStringTag]; if (k === 60) array[Symbol.toStringTag] = "Listed"; if (k === 70) Object.setPrototypeOf(changing, own); if (k === 80) Object.setPrototypeOf(changing, null);
  seen.push(toString.call(changing), toString.call(array), toString.call(date), toString.call(instance));
}
console.log(seen.join(" ").replace(/\[object /g, "").replace(/\]/g, "")); for (let k = 0; k < 3; k++) { try { tags([1, throwing]); } catch (error) { console.log(error.name, error.message); } }
const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); for (let k = 0; k < 3; k++) { try { tags([{}, proxy]); } catch (error) { console.log(error.name); } } console.log(turns);
