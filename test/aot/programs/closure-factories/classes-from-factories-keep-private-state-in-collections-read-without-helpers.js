// Downleveled private members of class expressions that functions return: written by hand, without helpers. The collection is declared before the function, behind it, or in it, and code outside the class uses the collection too.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
const m1 = new WeakMap();
const make1 = () => class { constructor(v) { m1.set(this, v); } read() { return m1.get(this); } };
const C1 = make1();
function f1() { const o = new C1(7); m1.set(o, 9); return [o.read(), o.read()].join(); }
show("declared before the factory, code outside the class stores an entry", () => f1());
const m2 = new WeakMap();
const make2 = () => class { constructor(v) { m2.set(this, v); } read() { return m2.get(this); } };
class S2 extends make2() {}
show("declared before the factory, a subclass instance reads", () => new S2(7).read());
const m3 = new WeakMap();
const make3 = () => class { constructor(v) { m3.set(this, v); } read() { return m3.get(this); } };
const C3 = make3();
show("declared before the factory, two instances read", () => [new C3(7).read(), new C3(8).read()]);
const m4 = new WeakMap();
const make4 = () => class { constructor(v) { m4.set(this, v); } read() { return m4.get(this); } };
const A4 = make4(), B4 = make4();
const a4 = new A4(1), b4 = new B4(2);
show("declared before the factory, two classes share the collection", () => [a4.read(), b4.read(), A4.prototype.read.call(b4), B4.prototype.read.call(a4)]);
const m5 = new WeakMap();
const make5 = () => class { constructor(v) { m5.set(this, v); } read() { return m5.get(this); } };
const C5 = make5();
const o5 = new C5(7);
show("declared before the factory, code outside the class asks and deletes, before", () => [m5.has(o5), m5.get(o5), m5.delete(o5), m5.has(o5)]);
show("declared before the factory, code outside the class asks and deletes", () => o5.read());
const m6 = new WeakMap();
const make6 = () => class { constructor(v) { m6.set(this, v); } read() { return m6.get(this); } };
const C6 = make6();
const s6 = {}; m6.set(s6, 'stranger');
show("declared before the factory, an object of no class has an entry", () => [C6.prototype.read.call(s6), new C6(1).read()]);
var m7;
const make7 = () => class { constructor(v) { m7.set(this, v); } read() { return m7.get(this); } };
m7 = new WeakMap();
const C7 = make7();
function f7() { const o = new C7(7); m7.set(o, 9); return [o.read(), o.read()].join(); }
show("a var that is filled behind the factory, code outside the class stores an entry", () => f7());
var m8;
const make8 = () => class { constructor(v) { m8.set(this, v); } read() { return m8.get(this); } };
m8 = new WeakMap();
class S8 extends make8() {}
show("a var that is filled behind the factory, a subclass instance reads", () => new S8(7).read());
var m9;
const make9 = () => class { constructor(v) { m9.set(this, v); } read() { return m9.get(this); } };
m9 = new WeakMap();
const C9 = make9();
show("a var that is filled behind the factory, two instances read", () => [new C9(7).read(), new C9(8).read()]);
var m10;
const make10 = () => class { constructor(v) { m10.set(this, v); } read() { return m10.get(this); } };
m10 = new WeakMap();
const A10 = make10(), B10 = make10();
const a10 = new A10(1), b10 = new B10(2);
show("a var that is filled behind the factory, two classes share the collection", () => [a10.read(), b10.read(), A10.prototype.read.call(b10), B10.prototype.read.call(a10)]);
var m11;
const make11 = () => class { constructor(v) { m11.set(this, v); } read() { return m11.get(this); } };
m11 = new WeakMap();
const C11 = make11();
const o11 = new C11(7);
show("a var that is filled behind the factory, code outside the class asks and deletes, before", () => [m11.has(o11), m11.get(o11), m11.delete(o11), m11.has(o11)]);
show("a var that is filled behind the factory, code outside the class asks and deletes", () => o11.read());
var m12;
const make12 = () => class { constructor(v) { m12.set(this, v); } read() { return m12.get(this); } };
m12 = new WeakMap();
const C12 = make12();
const s12 = {}; m12.set(s12, 'stranger');
show("a var that is filled behind the factory, an object of no class has an entry", () => [C12.prototype.read.call(s12), new C12(1).read()]);
var m13;
const make13 = () => { m13 = new WeakMap(); return class { constructor(v) { m13.set(this, v); } read() { return m13.get(this); } }; };
const C13 = make13();
function f13() { const o = new C13(7); m13.set(o, 9); return [o.read(), o.read()].join(); }
show("created by each call of the factory, code outside the class stores an entry", () => f13());
var m14;
const make14 = () => { m14 = new WeakMap(); return class { constructor(v) { m14.set(this, v); } read() { return m14.get(this); } }; };
class S14 extends make14() {}
show("created by each call of the factory, a subclass instance reads", () => new S14(7).read());
var m15;
const make15 = () => { m15 = new WeakMap(); return class { constructor(v) { m15.set(this, v); } read() { return m15.get(this); } }; };
const C15 = make15();
show("created by each call of the factory, two instances read", () => [new C15(7).read(), new C15(8).read()]);
var m16;
const make16 = () => { m16 = new WeakMap(); return class { constructor(v) { m16.set(this, v); } read() { return m16.get(this); } }; };
const A16 = make16(), B16 = make16();
const a16 = new A16(1), b16 = new B16(2);
show("created by each call of the factory, two classes share the collection", () => [a16.read(), b16.read(), A16.prototype.read.call(b16), B16.prototype.read.call(a16)]);
var m17;
const make17 = () => { m17 = new WeakMap(); return class { constructor(v) { m17.set(this, v); } read() { return m17.get(this); } }; };
const C17 = make17();
const o17 = new C17(7);
show("created by each call of the factory, code outside the class asks and deletes, before", () => [m17.has(o17), m17.get(o17), m17.delete(o17), m17.has(o17)]);
show("created by each call of the factory, code outside the class asks and deletes", () => o17.read());
var m18;
const make18 = () => { m18 = new WeakMap(); return class { constructor(v) { m18.set(this, v); } read() { return m18.get(this); } }; };
const C18 = make18();
const s18 = {}; m18.set(s18, 'stranger');
show("created by each call of the factory, an object of no class has an entry", () => [C18.prototype.read.call(s18), new C18(1).read()]);
let m19 = new WeakMap();
const make19 = () => { const inner = new WeakMap(); m19 = inner; return class { constructor(v) { inner.set(this, v); } read() { return inner.get(this); } }; };
const C19 = make19();
function f19() { const o = new C19(7); m19.set(o, 9); return [o.read(), o.read()].join(); }
show("a variable of the factory, code outside the class stores an entry", () => f19());
let m20 = new WeakMap();
const make20 = () => { const inner = new WeakMap(); m20 = inner; return class { constructor(v) { inner.set(this, v); } read() { return inner.get(this); } }; };
class S20 extends make20() {}
show("a variable of the factory, a subclass instance reads", () => new S20(7).read());
let m21 = new WeakMap();
const make21 = () => { const inner = new WeakMap(); m21 = inner; return class { constructor(v) { inner.set(this, v); } read() { return inner.get(this); } }; };
const C21 = make21();
show("a variable of the factory, two instances read", () => [new C21(7).read(), new C21(8).read()]);
let m22 = new WeakMap();
const make22 = () => { const inner = new WeakMap(); m22 = inner; return class { constructor(v) { inner.set(this, v); } read() { return inner.get(this); } }; };
const A22 = make22(), B22 = make22();
const a22 = new A22(1), b22 = new B22(2);
show("a variable of the factory, two classes share the collection", () => [a22.read(), b22.read(), A22.prototype.read.call(b22), B22.prototype.read.call(a22)]);
let m23 = new WeakMap();
const make23 = () => { const inner = new WeakMap(); m23 = inner; return class { constructor(v) { inner.set(this, v); } read() { return inner.get(this); } }; };
const C23 = make23();
const o23 = new C23(7);
show("a variable of the factory, code outside the class asks and deletes, before", () => [m23.has(o23), m23.get(o23), m23.delete(o23), m23.has(o23)]);
show("a variable of the factory, code outside the class asks and deletes", () => o23.read());
let m24 = new WeakMap();
const make24 = () => { const inner = new WeakMap(); m24 = inner; return class { constructor(v) { inner.set(this, v); } read() { return inner.get(this); } }; };
const C24 = make24();
const s24 = {}; m24.set(s24, 'stranger');
show("a variable of the factory, an object of no class has an entry", () => [C24.prototype.read.call(s24), new C24(1).read()]);
const w25 = new WeakSet();
class P25 {}
const mix25 = Base => class extends Base { constructor(v) { super(); w25.add(this); this.v = v; } is() { return w25.has(this); } };
class S25 extends mix25(P25) {}
show("a WeakSet, a subclass of a mixin with a field", () => new S25(7).is());
const w26 = new WeakSet();
class P26 {}
const mix26 = Base => class extends Base { constructor(v) { super(); w26.add(this); } is() { return w26.has(this); } };
class S26 extends mix26(P26) {}
show("a WeakSet, a subclass of a mixin", () => new S26(7).is());
const w27 = new WeakSet();
const mix27 = Base => class extends Base { constructor(v) { super(); w27.add(this); this.v = v; } is() { return w27.has(this); } };
const C27 = mix27(Object);
show("a WeakSet, the class of a mixin", () => [new C27(7).is(), C27.prototype.is.call({})]);
const w28 = new WeakSet();
const mix28 = Base => class extends Base { is() { return w28.has(this); } };
const C28 = mix28(Object);
const o28 = new C28();
show("a WeakSet, code outside the class adds and deletes", () => (() => { const r = [o28.is()]; w28.add(o28); r.push(o28.is()); w28.delete(o28); r.push(o28.is()); return r; })());
const strong = new Map();
const makeStrong = () => class { constructor(v) { strong.set(this, v); } read() { return strong.get(this); } };
class Strong extends makeStrong() {}
const held = new Strong(3);
strong.set(held, 4);
show("a Map", () => [held.read(), strong.size]);
