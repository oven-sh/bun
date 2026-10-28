"use strict";
var log = [];
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
function Empty() {}
function NoThis(a) { log.push("NoThis " + a); }
function ReturnsObject(flag) { this.own = 1; if (flag === 1) return { other: 2 }; if (flag === 2) return function f() {}; if (flag === 3) return null; if (flag === 4) return 7; if (flag === 5) return "s"; if (flag === 6) return [1]; if (flag === 7) return undefined; if (flag === 8) return Symbol.iterator; }
function CallableToo(x) { if (!(this instanceof CallableToo)) return new CallableToo(x); this.x = x; }
function Throws(x) { this.x = x; throw new Error("from the constructor " + x); }
function Rest(...args) { this.n = args.length; this.first = args[0]; }
function Defaults(a = 1, b = a + 1) { this.a = a; this.b = b; }
function UsesArguments() { this.n = arguments.length; }
function makeCounter(start) { return function Counter(step) { this.value = start + step; }; }
function Recursive(n) { this.n = n; this.next = n ? new Recursive(n - 1) : null; }
function Frozen() { Object.freeze(this); }
function Leaks() { log.push(Object.getPrototypeOf(this) === Leaks.prototype, Object.keys(this).length, this.constructor === Leaks); }
class Base { constructor(x) { this.x = x; } get double() { return this.x * 2; } static make(x) { return new this(x); } }
class Fields { a = 1; b = this.a + 1; ["c" + 1] = 3; }
class FieldsAndConstructor { a = log.push("field"); constructor() { log.push("body"); this.z = this.a; } }
class ReturnsFromClass { constructor(flag) { this.own = 1; if (flag) return { other: 2 }; } }
class PrivateFields { #p = 5; get p() { return this.#p; } static has(o) { return #p in o; } }
const arrow = () => {};
const method = { m() {} }.m;
async function asynchronous() {}
function* generator() {}

function describe(o) { return o === null ? "null" : typeof o !== "object" && typeof o !== "function" ? typeof o + " " + String(o) : (typeof o) + " " + JSON.stringify(o) + " " + Object.keys(o).join() + " " + (Object.getPrototypeOf(o) === Object.prototype ? "Object.prototype" : Object.getPrototypeOf(o) === null ? "null" : (Object.getPrototypeOf(o).constructor || {}).name); }
function attempt(f) { try { return describe(f()); } catch (e) { return "threw " + e.constructor.name + (e.message.startsWith("from") ? ": " + e.message : ""); } }
function known() {
  const out = [];
  out.push(attempt(() => new Point(1, 2)), attempt(() => new Point(1)), attempt(() => new Point(1, 2, 3)), attempt(() => new Point), attempt(() => new Point(1, 2).sum()));
  out.push(attempt(() => new Empty()), attempt(() => new NoThis(1)), attempt(() => new Rest()), attempt(() => new Rest(1, 2, 3, 4, 5, 6)), attempt(() => new Defaults()), attempt(() => new Defaults(5)), attempt(() => new UsesArguments(1, 2)));
  for (let flag = 0; flag <= 8; flag++) out.push(attempt(() => new ReturnsObject(flag)));
  out.push(attempt(() => new CallableToo(1)), attempt(() => CallableToo(2)), attempt(() => new Throws(1)), attempt(() => new Recursive(3)), attempt(() => new Frozen()), attempt(() => new Leaks()));
  out.push(attempt(() => new Base(4)), attempt(() => new Base(4).double), attempt(() => Base.make(5)), attempt(() => new Fields()), attempt(() => new FieldsAndConstructor()), attempt(() => new ReturnsFromClass(0)), attempt(() => new ReturnsFromClass(1)));
  out.push(attempt(() => new PrivateFields().p), attempt(() => PrivateFields.has(new PrivateFields())), attempt(() => PrivateFields.has({})));
  out.push(attempt(() => new arrow()), attempt(() => new method()), attempt(() => new asynchronous()), attempt(() => new generator()), attempt(() => Base(1)), attempt(() => new (makeCounter(10))(5)));
  return out;
}
// The order of things: the callee, then the arguments, then the read of `prototype`.
function order() {
  const out = [];
  function F(a) { this.a = a; }
  const first = F.prototype;
  const o = new F((F.prototype = { replaced: true }, 1));
  out.push(Object.getPrototypeOf(o) === first, Object.getPrototypeOf(o).replaced === true);
  return out;
}
// `prototype` is replaced, is not an object, or is changed in place, between constructions at the same site.
function prototypes() {
  const out = [];
  function G() { this.g = 1; }
  const make = () => new G();
  const a = make(); const p1 = G.prototype;
  G.prototype = { second: true }; const b = make();
  G.prototype = null; const c = make();
  G.prototype = 5; const d = make();
  G.prototype = p1; const e = make();
  p1.late = "late"; const proxy = new Proxy({}, {}); G.prototype = proxy; const f = make();
  G.prototype = Object.create(null); const g = make();
  G.prototype = Array.prototype; const h = make();
  G.prototype = function () {}; const i = make();
  out.push(Object.getPrototypeOf(a) === p1, b.second, Object.getPrototypeOf(c) === Object.prototype, Object.getPrototypeOf(d) === Object.prototype, Object.getPrototypeOf(e) === p1, a.late, e.late,
    Object.getPrototypeOf(f) === proxy, Object.getPrototypeOf(Object.getPrototypeOf(g)), Array.isArray(h), h instanceof Array, typeof Object.getPrototypeOf(i), a instanceof G, i instanceof G);
  return out;
}
// Many closures of one function: each has its own `prototype`.
function closures() {
  const A = makeCounter(1), B = makeCounter(2);
  const a = new A(1), b = new B(1);
  return [a.value, b.value, a instanceof A, a instanceof B, b instanceof B, Object.getPrototypeOf(a) === A.prototype, A.prototype !== B.prototype, a.constructor === A];
}
// One site, many callees: the expected callee is not the one that arrives.
function mixed(list) { return list.map(F => attempt(() => new F(1, 2))); }
// Objects are ordinary: everything an ordinary object allows.
function ordinary() {
  const p = new Point(1, 2);
  p.z = 3; delete p.x; Object.defineProperty(p, "w", { get() { return 9; }, enumerable: true }); p[0] = "i"; p[Symbol.for("s")] = 1; Object.setPrototypeOf(p, null);
  return [Object.keys(p).join(), p.w, p[0], Object.getPrototypeOf(p), Object.getOwnPropertySymbols(p).length];
}
module.exports = { log, known, order, prototypes, closures, mixed, ordinary, Point, Empty, ReturnsObject, Base, Fields, arrow, makeCounter, Rest };
