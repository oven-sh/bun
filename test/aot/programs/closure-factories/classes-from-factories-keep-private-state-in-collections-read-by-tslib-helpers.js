// Downleveled private members of class expressions that functions return: the helpers of tslib. The collection is declared before the function, behind it, or in it, and code outside the class uses the collection too.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
var __classPrivateFieldGet = function (receiver, state, kind, f) { if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter"); if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it"); return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver); };
var __classPrivateFieldSet = function (receiver, state, value, kind, f) { if (kind === "m") throw new TypeError("Private method is not writable"); if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter"); if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it"); return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value; };
var __classPrivateFieldIn = function (state, receiver) { if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object"); return typeof state === "function" ? receiver === state : state.has(receiver); };
const m1 = new WeakMap();
const make1 = () => class { constructor(v) { m1.set(this, v); } read() { return __classPrivateFieldGet(this, m1, "f"); } };
const C1 = make1();
function f1() { const o = new C1(7); m1.set(o, 9); return [o.read(), o.read()].join(); }
show("declared before the factory, code outside the class stores an entry", () => f1());
const m2 = new WeakMap();
const make2 = () => class { constructor(v) { m2.set(this, v); } read() { return __classPrivateFieldGet(this, m2, "f"); } };
class S2 extends make2() {}
show("declared before the factory, a subclass instance reads", () => new S2(7).read());
const m3 = new WeakMap();
const make3 = () => class { constructor(v) { m3.set(this, v); } read() { return __classPrivateFieldGet(this, m3, "f"); } };
const C3 = make3();
show("declared before the factory, two instances read", () => [new C3(7).read(), new C3(8).read()]);
const m4 = new WeakMap();
const make4 = () => class { constructor(v) { m4.set(this, v); } read() { return __classPrivateFieldGet(this, m4, "f"); } };
const A4 = make4(), B4 = make4();
const a4 = new A4(1), b4 = new B4(2);
show("declared before the factory, two classes share the collection", () => [a4.read(), b4.read(), A4.prototype.read.call(b4), B4.prototype.read.call(a4)]);
const m5 = new WeakMap();
const make5 = () => class { constructor(v) { m5.set(this, v); } read() { return __classPrivateFieldGet(this, m5, "f"); } };
const C5 = make5();
const o5 = new C5(7);
show("declared before the factory, code outside the class asks and deletes, before", () => [m5.has(o5), m5.get(o5), m5.delete(o5), m5.has(o5)]);
show("declared before the factory, code outside the class asks and deletes", () => o5.read());
const m6 = new WeakMap();
const make6 = () => class { constructor(v) { m6.set(this, v); } read() { return __classPrivateFieldGet(this, m6, "f"); } };
const C6 = make6();
const s6 = {}; m6.set(s6, 'stranger');
show("declared before the factory, an object of no class has an entry", () => [C6.prototype.read.call(s6), new C6(1).read()]);
var m7;
const make7 = () => class { constructor(v) { m7.set(this, v); } read() { return __classPrivateFieldGet(this, m7, "f"); } };
m7 = new WeakMap();
const C7 = make7();
function f7() { const o = new C7(7); m7.set(o, 9); return [o.read(), o.read()].join(); }
show("a var that is filled behind the factory, code outside the class stores an entry", () => f7());
var m8;
const make8 = () => class { constructor(v) { m8.set(this, v); } read() { return __classPrivateFieldGet(this, m8, "f"); } };
m8 = new WeakMap();
class S8 extends make8() {}
show("a var that is filled behind the factory, a subclass instance reads", () => new S8(7).read());
var m9;
const make9 = () => class { constructor(v) { m9.set(this, v); } read() { return __classPrivateFieldGet(this, m9, "f"); } };
m9 = new WeakMap();
const C9 = make9();
show("a var that is filled behind the factory, two instances read", () => [new C9(7).read(), new C9(8).read()]);
var m10;
const make10 = () => class { constructor(v) { m10.set(this, v); } read() { return __classPrivateFieldGet(this, m10, "f"); } };
m10 = new WeakMap();
const A10 = make10(), B10 = make10();
const a10 = new A10(1), b10 = new B10(2);
show("a var that is filled behind the factory, two classes share the collection", () => [a10.read(), b10.read(), A10.prototype.read.call(b10), B10.prototype.read.call(a10)]);
var m11;
const make11 = () => class { constructor(v) { m11.set(this, v); } read() { return __classPrivateFieldGet(this, m11, "f"); } };
m11 = new WeakMap();
const C11 = make11();
const o11 = new C11(7);
show("a var that is filled behind the factory, code outside the class asks and deletes, before", () => [m11.has(o11), m11.get(o11), m11.delete(o11), m11.has(o11)]);
show("a var that is filled behind the factory, code outside the class asks and deletes", () => o11.read());
var m12;
const make12 = () => class { constructor(v) { m12.set(this, v); } read() { return __classPrivateFieldGet(this, m12, "f"); } };
m12 = new WeakMap();
const C12 = make12();
const s12 = {}; m12.set(s12, 'stranger');
show("a var that is filled behind the factory, an object of no class has an entry", () => [C12.prototype.read.call(s12), new C12(1).read()]);
var m13;
const make13 = () => { m13 = new WeakMap(); return class { constructor(v) { m13.set(this, v); } read() { return __classPrivateFieldGet(this, m13, "f"); } }; };
const C13 = make13();
function f13() { const o = new C13(7); m13.set(o, 9); return [o.read(), o.read()].join(); }
show("created by each call of the factory, code outside the class stores an entry", () => f13());
var m14;
const make14 = () => { m14 = new WeakMap(); return class { constructor(v) { m14.set(this, v); } read() { return __classPrivateFieldGet(this, m14, "f"); } }; };
class S14 extends make14() {}
show("created by each call of the factory, a subclass instance reads", () => new S14(7).read());
var m15;
const make15 = () => { m15 = new WeakMap(); return class { constructor(v) { m15.set(this, v); } read() { return __classPrivateFieldGet(this, m15, "f"); } }; };
const C15 = make15();
show("created by each call of the factory, two instances read", () => [new C15(7).read(), new C15(8).read()]);
var m16;
const make16 = () => { m16 = new WeakMap(); return class { constructor(v) { m16.set(this, v); } read() { return __classPrivateFieldGet(this, m16, "f"); } }; };
const A16 = make16(), B16 = make16();
const a16 = new A16(1), b16 = new B16(2);
show("created by each call of the factory, two classes share the collection", () => [a16.read(), b16.read(), A16.prototype.read.call(b16), B16.prototype.read.call(a16)]);
var m17;
const make17 = () => { m17 = new WeakMap(); return class { constructor(v) { m17.set(this, v); } read() { return __classPrivateFieldGet(this, m17, "f"); } }; };
const C17 = make17();
const o17 = new C17(7);
show("created by each call of the factory, code outside the class asks and deletes, before", () => [m17.has(o17), m17.get(o17), m17.delete(o17), m17.has(o17)]);
show("created by each call of the factory, code outside the class asks and deletes", () => o17.read());
var m18;
const make18 = () => { m18 = new WeakMap(); return class { constructor(v) { m18.set(this, v); } read() { return __classPrivateFieldGet(this, m18, "f"); } }; };
const C18 = make18();
const s18 = {}; m18.set(s18, 'stranger');
show("created by each call of the factory, an object of no class has an entry", () => [C18.prototype.read.call(s18), new C18(1).read()]);
let m19 = new WeakMap();
const make19 = () => { const inner = new WeakMap(); m19 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C19 = make19();
function f19() { const o = new C19(7); m19.set(o, 9); return [o.read(), o.read()].join(); }
show("a variable of the factory, code outside the class stores an entry", () => f19());
let m20 = new WeakMap();
const make20 = () => { const inner = new WeakMap(); m20 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
class S20 extends make20() {}
show("a variable of the factory, a subclass instance reads", () => new S20(7).read());
let m21 = new WeakMap();
const make21 = () => { const inner = new WeakMap(); m21 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C21 = make21();
show("a variable of the factory, two instances read", () => [new C21(7).read(), new C21(8).read()]);
let m22 = new WeakMap();
const make22 = () => { const inner = new WeakMap(); m22 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const A22 = make22(), B22 = make22();
const a22 = new A22(1), b22 = new B22(2);
show("a variable of the factory, two classes share the collection", () => [a22.read(), b22.read(), A22.prototype.read.call(b22), B22.prototype.read.call(a22)]);
let m23 = new WeakMap();
const make23 = () => { const inner = new WeakMap(); m23 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C23 = make23();
const o23 = new C23(7);
show("a variable of the factory, code outside the class asks and deletes, before", () => [m23.has(o23), m23.get(o23), m23.delete(o23), m23.has(o23)]);
show("a variable of the factory, code outside the class asks and deletes", () => o23.read());
let m24 = new WeakMap();
const make24 = () => { const inner = new WeakMap(); m24 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C24 = make24();
const s24 = {}; m24.set(s24, 'stranger');
show("a variable of the factory, an object of no class has an entry", () => [C24.prototype.read.call(s24), new C24(1).read()]);
const w25 = new WeakSet();
class P25 {}
const mix25 = Base => class extends Base { constructor(v) { super(); w25.add(this); this.v = v; } is() { return __classPrivateFieldIn(w25, this); } };
class S25 extends mix25(P25) {}
show("a WeakSet, a subclass of a mixin with a field", () => new S25(7).is());
const w26 = new WeakSet();
class P26 {}
const mix26 = Base => class extends Base { constructor(v) { super(); w26.add(this); } is() { return __classPrivateFieldIn(w26, this); } };
class S26 extends mix26(P26) {}
show("a WeakSet, a subclass of a mixin", () => new S26(7).is());
const w27 = new WeakSet();
const mix27 = Base => class extends Base { constructor(v) { super(); w27.add(this); this.v = v; } is() { return __classPrivateFieldIn(w27, this); } };
const C27 = mix27(Object);
show("a WeakSet, the class of a mixin", () => [new C27(7).is(), C27.prototype.is.call({})]);
const w28 = new WeakSet();
const mix28 = Base => class extends Base { is() { return __classPrivateFieldIn(w28, this); } };
const C28 = mix28(Object);
const o28 = new C28();
show("a WeakSet, code outside the class adds and deletes", () => (() => { const r = [o28.is()]; w28.add(o28); r.push(o28.is()); w28.delete(o28); r.push(o28.is()); return r; })());
const makeEmitted = (Base = Object) => { var _x, _a; return _a = class extends Base { constructor(v) { super(); _x.set(this, void 0); __classPrivateFieldSet(this, _x, v, "f"); } read() { return __classPrivateFieldGet(this, _x, "f"); } }, _x = new WeakMap(), _a; };
class EmittedBelow extends makeEmitted() {}
const EmittedA = makeEmitted(), EmittedB = makeEmitted();
show("as TypeScript emits a class expression, a subclass instance reads", () => new EmittedBelow(7).read());
show("as TypeScript emits a class expression, two classes", () => [new EmittedA(1).read(), new EmittedB(2).read()]);
show("as TypeScript emits a class expression, an instance of the other class is refused", () => EmittedA.prototype.read.call(new EmittedB(2)));
var _inst = new WeakSet(), _step = function () { return 3; };
const makeWithMethod = () => class { constructor() { _inst.add(this); } run() { return __classPrivateFieldGet(this, _inst, "m", _step).call(this); } };
class WithMethod extends makeWithMethod() {}
show("a private method", () => new WithMethod().run());
const makeWithStatic = () => { var _a, _C_n; return _a = class C { static take() { var _b; return __classPrivateFieldSet(_a, _a, (_b = __classPrivateFieldGet(_a, _a, "f", _C_n), _b++, _b), "f", _C_n); } }, _C_n = { value: 1 }, _a; };
const WithStatic = makeWithStatic();
show("a private static field", () => [WithStatic.take(), WithStatic.take()]);
