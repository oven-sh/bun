// A constructor stores a flag on its prototype each time: a store of the value that is held changes nothing, every other store is seen.
"use strict";
const lines = [];
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "object" : String(v));
function attempt(f) { try { return show(f()); } catch (e) { return e.name; } }
class A { constructor(x) { A.prototype.isA = true; this.x = x; } }
class B extends A { constructor(x) { super(x); B.prototype.isB = true; B.prototype.isA = B.prototype.isA; } }
class Many { constructor() { Many.prototype.flag = 1; } a0() {} a1() {} a2() {} a3() {} a4() {} a5() {} a6() {} a7() {} a8() {} a9() {} get g() { return this.flag; } static s() {} }
for (let i = 0; i < 70; i++) Many.prototype["m" + i] = function () { return i; };
function F(x) { F.prototype.isF = true; F.prototype.zero = 0; F.prototype.nan = NaN; F.prototype.text = "abc"; this.x = x; }
function G() { G.prototype.f = G.helper; }
G.helper = () => 1;
globalThis.keep = [A, B, Many, F, G];
const make = [() => new A(1), () => new B(2), () => new Many(), () => new F(3), () => new G()];
function all(label) {
  for (let i = 0; i < 4; i++) for (const m of make) attempt(m);
  const a = new A(1), b = new B(2), f = new F(3), m = new Many(), g = new G();
  lines.push(label + ": " + [a.isA, b.isA, b.isB, f.isF, f.zero, f.nan, f.text, m.flag, m.g, m.m3(), g.f, Object.keys(F.prototype), Object.keys(A.prototype)].map(show).join());
}
all("as made");
A.prototype.isA = 1; lines.push(show(Object.create(A.prototype).isA)); all("A.isA was 1");
F.prototype.zero = -0; lines.push(show(Object.create(F.prototype).zero)); all("zero was -0");
F.prototype.nan = 5; F.prototype.text = "ab" + "c"; lines.push(show(Object.create(F.prototype).nan)); all("nan was 5");
delete A.prototype.isA; lines.push(show(Object.create(A.prototype).isA)); all("isA was deleted");
Object.defineProperty(F.prototype, "isF", { get() { lines.push("get isF"); return 7; }, set(v) { lines.push("set isF " + v); }, configurable: true }); lines.push(attempt(() => new F(1).isF)); delete F.prototype.isF; all("isF was an accessor");
Object.defineProperty(F.prototype, "text", { value: "abc", writable: false, configurable: true }); lines.push(attempt(() => new F(1).x)); Object.defineProperty(F.prototype, "text", { value: "abc", writable: true, enumerable: false, configurable: true }); all("text was read-only");
Many.prototype.flag = "1"; lines.push(show(new Many().flag)); delete Many.prototype.m5; all("m5 is gone");
Object.setPrototypeOf(F.prototype, A.prototype); all("F below A");
F.prototype = { zero: 3 }; all("another prototype");
G.helper = () => 2; lines.push(show(new G().f())); all("another helper");
Object.freeze(Many.prototype); lines.push(attempt(() => new Many().flag));
Object.freeze(B.prototype); lines.push(attempt(() => new B(1).isB));
const key = ["isA", "isB"][lines.length & 0];
function byKey(o, k, v) { o[k] = v; return o[k]; }
for (let i = 0; i < 6; i++) lines.push(show(byKey(A.prototype, key, i < 3)), show(new A(1).isA), show(Reflect.set(A.prototype, "isA", true)), show(Reflect.set(A.prototype, "isA", true, a => a)));
let hits = 0;
for (let i = 0; i < 2000; i++) { const a = new A(i), f = new F(i); if (a.isA === true) hits++; if (f.isF) hits++; if (i % 500 === 499) A.prototype.isA = false, hits += Object.create(A.prototype).isA ? 1000 : 0; }
lines.push(hits);
console.log(lines.join("\n"));
