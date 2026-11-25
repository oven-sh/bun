// COUNTER: operationAOTConstructWithArray <= 60
// Reflect.construct enters a closure with the elements of an array, and makes heirs of Error as super() does.
function shown(e) { return e && typeof e.stack === "string" ? e.stack.split("\n").map(l => l.trim().replace(/\(.*\//, "(").replace(/:\d.*/, "")).join(" < ") : String(e && e.stack); }
function E1(m) { return Reflect.construct(Error, [m], new.target || E1); }
E1.prototype = Object.create(Error.prototype, { constructor: { value: E1 } });
function deep(n) { return n ? deep(n - 1) : new E1("a"); }
console.log(shown(deep(2)));
function viaArguments() { return Reflect.construct(Error, arguments, E1); }
console.log(shown(viaArguments("b")));
console.log(shown(new (class E3 extends E1 { constructor(m) { super(m); } })("c")));
function E4(m, o) { var made = Reflect.construct(Error, arguments, E4); return made; }
E4.prototype = Object.create(Error.prototype);
console.log(shown(new E4("d", { cause: 1 })), new E4("d", { cause: 1 }).cause, Object.getPrototypeOf(new E4("x")) === E4.prototype, new E4("x") instanceof E4);
class Native extends Error {}
console.log(Reflect.construct(Native, ["e"], E4).message, Reflect.construct(Error, ["f"]).message, Reflect.construct(Error, []).message);
console.log(Reflect.construct(TypeError, ["g"], E4).message, Reflect.construct(TypeError, ["g"], E4) instanceof TypeError);
for (const bad of [[1, []], [Error, 1], [Error, [], 1], [Error, [], () => 1], [() => 1, []], [Error, [], E4, 1], [Error, { length: 2, 0: "h", 1: { cause: 2 } }, E4], [Error, "ab", E4], [Error, [Symbol("s")], E4], [Error, [{ toString() { throw new RangeError("t"); } }], E4], [Error, , E4], [Error, null, E4]])
  try { const made = Reflect.construct(...bad); console.log(made.message, made.cause, Object.keys(made).join()); } catch (e) { console.log(e.name, e.message); }
const order = [];
const target = new Proxy(function T() {}, { construct(t, a, n) { order.push("construct", a.length, n === target); return {}; } });
Reflect.construct(target, [1, 2]); Reflect.construct(target, [1], E4);
console.log(order.join());
function Base(a, b) { this.a = a; this.b = b; this.nt = new.target === Below; this.n = arguments.length; }
function Below() {} Below.prototype = { below: true };
function go(list) { return Reflect.construct(Base, list, Below); }
for (const list of [[], [1], [1, 2], [1.5, 2.5], [, 2], [1, , 3], Object.freeze([7, 8]), [1, 2, 3, 4, 5, 6, 7, 8, 9], Array(3), ["x", NaN, -0], new Uint8Array([3, 4]), { length: 1, 0: "o" }]) console.log(JSON.stringify(go(list)), go(list).below);
Below.prototype = null; console.log(Object.getPrototypeOf(go([1])) === Object.prototype);
const late = [1, 2]; Object.defineProperty(late, 0, { get() { order.push("get"); return 5; } }); console.log(go(late).a, order.at(-1));
console.log(Reflect.construct(Map, [], E4) instanceof Map === false, Reflect.construct(Array, [3], E4).length, Reflect.construct(Date, [0], E4) instanceof E4, Object.prototype.toString.call(Reflect.construct(Error, [], E4)));
for (let i = 0, t = 0; i < 300; i++) { t += Reflect.construct(Base, [i, 1], i & 1 ? Below : Base).a; if (i === 299) console.log(t); }
