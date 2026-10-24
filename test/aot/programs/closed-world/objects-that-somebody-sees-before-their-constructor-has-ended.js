// Eleven ways to see an object before its constructor has stored every field.
const log = (...a) => console.log(a.map(x => typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)).join(" "));
// 1: the class above calls a method that the class below overrides, before the fields below exist
class A1 { constructor() { this.a = 1; this.seen = this.look(); } look() { return "A"; } }
class B1 extends A1 { y = 7; z = "s"; look() { return [this.y, this.z, "y" in this, Object.keys(this).join()].join("|"); } }
log(1, new B1().seen, new B1().y);
// 2: the class above hands `this` out, then the initializer below throws
const kept2 = [];
class A2 { constructor() { this.a = 1; kept2.push(this); } }
let fail2 = true;
class B2 extends A2 { y = (() => { if (fail2) throw new Error("no"); return 5; })(); w = 2.5; sum() { return this.y + this.w; } }
try { new B2(); } catch (e) { log(2, e.message); }
fail2 = false; new B2();
for (const o of kept2) log(2, o.y, o.w, o.sum(), Object.keys(o).join(), o.hasOwnProperty("w"));
// 3: Reflect.construct with another function in place of the constructor
class C3 { constructor() { this.p = 1; this.q = "two"; } get both() { return this.p + this.q; } }
function Other3() { this.r = 3; }
const o3 = Reflect.construct(Other3, [], C3);
log(3, o3 instanceof C3, o3.p, o3.q, o3.both, o3.r, Object.keys(o3).join());
const o3b = Reflect.construct(Object, [], C3);
log(3, o3b instanceof C3, o3b.p, o3b.both, Object.keys(o3b).join());
// 4: Object.create of the prototype
class C4 { constructor() { this.p = 1.5; this.q = { n: 1 }; } m() { return this.p * 2 + (this.q ? this.q.n : -1); } }
const all4 = [new C4(), Object.create(C4.prototype), new C4()];
for (const o of all4) log(4, o.m(), o.p, o.q);
// 5: the constructor above returns another object
const foreign5 = { f: 1 };
class A5 { constructor(x) { if (x) return foreign5; this.a = 1; } }
class B5 extends A5 { y = 9; m() { return this.y; } }
const o5 = new B5(true), p5 = new B5(false);
log(5, o5 === foreign5, o5.y, foreign5, o5 instanceof B5, p5.m(), p5);
// 6: the object leaks through a setter that it inherits
let got6 = null;
class A6 { set tap(v) { got6 = this; } }
class B6 extends A6 { constructor() { super(); this.tap = 1; this.late = 4; this.later = "x"; } }
const probe6 = () => got6 ? [got6.late, got6.later, Object.keys(got6).length].join() : "none";
class D6 extends A6 { constructor() { super(); this.tap = 1; log(6, probe6()); this.late = 4; this.later = "x"; } }
new B6(); log(6, probe6()); new D6(); log(6, probe6());
// 7: a throw in the middle of a constructor, the object kept by a closure
let peek7;
class C7 { constructor(n) { this.a = n; peek7 = () => [this.a, this.b, this.c, "c" in this].join(); if (n > 1) throw new Error("mid"); this.b = n * 2; this.c = "c"; } }
new C7(1); log(7, peek7()); try { new C7(2); } catch {} log(7, peek7());
// 8: a stack overflow in the middle of a constructor
const kept8 = [];
function deep8(n) { return n === 0 ? 0 : 1 + deep8(n - 1); }
class C8 { constructor(n) { this.a = 1; kept8.push(this); this.b = deep8(n); this.c = 3; } t() { return this.a + this.b + this.c; } }
new C8(3); try { new C8(1e7); } catch (e) { log(8, e instanceof RangeError); }
for (const o of kept8) log(8, o.t(), o.b, o.c, Object.keys(o).join());
// 9: constructor function called without new, on another object
function F9(v) { this.v = v; this.w = v + 1; }
F9.prototype.s = function () { return this.v + this.w; };
const bare9 = Object.create(F9.prototype); log(9, bare9.s(), bare9.v);
F9.call(bare9, 4); log(9, bare9.s()); const plain9 = {}; F9.call(plain9, 5); log(9, plain9);
// 10: field initializers that read fields below them
class C10 { a = this.b; b = 2; c = this.a; d = Object.keys(this).join(); }
log(10, new C10());
// 11: a getter of the class above reads a field of the class below through super's constructor and toString
class A11 { constructor() { this.text = `${this}`; } }
class B11 extends A11 { n = 5; toString() { return "n=" + this.n; } }
log(11, new B11().text, String(new B11()));
