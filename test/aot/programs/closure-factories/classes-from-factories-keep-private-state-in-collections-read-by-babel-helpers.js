// Downleveled private members of class expressions that functions return: the helpers of Babel. The collection is declared before the function, behind it, or in it, and code outside the class uses the collection too.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
function _classPrivateMethodInitSpec(e, a) { _checkPrivateRedeclaration(e, a), a.add(e); }
function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); }
function _classPrivateFieldGet2(s, a) { return s.get(_assertClassBrand(s, a)); }
function _classPrivateFieldSet2(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }
var _x1 = new WeakMap();
const make1 = () => class { constructor(v) { _classPrivateFieldInitSpec(this, _x1, v); } read() { return _classPrivateFieldGet2(_x1, this); } write(v) { return _classPrivateFieldSet2(_x1, this, v); } };
class S1 extends make1() {}
const s1 = new S1(7);
show("declared before the factory, a subclass instance", () => [s1.read(), s1.write(8), s1.read()]);
var _x2 = new WeakMap();
const make2 = () => class { constructor(v) { _classPrivateFieldInitSpec(this, _x2, v); } read() { return _classPrivateFieldGet2(_x2, this); } write(v) { return _classPrivateFieldSet2(_x2, this, v); } };
const C2 = make2();
const s2 = new C2(7);
_x2.set(s2, 1);
show("declared before the factory, code outside the class stores an entry", () => [s2.read(), s2.write(8), s2.read(), _x2.get(s2)]);
const make3 = () => { var _x3 = new WeakMap(); return class { constructor(v) { _classPrivateFieldInitSpec(this, _x3, v); } read() { return _classPrivateFieldGet2(_x3, this); } write(v) { return _classPrivateFieldSet2(_x3, this, v); } }; };
class S3 extends make3() {}
const s3 = new S3(7);
show("a variable of the factory", () => [s3.read(), s3.write(8), s3.read()]);
var _b4 = new WeakSet();
function _m4() { return 4; }
const make4 = () => class { constructor() { _classPrivateMethodInitSpec(this, _b4); } run() { return _assertClassBrand(_b4, this, _m4).call(this); } };
class S4 extends make4() {}
show("a private method", () => new S4().run());
show("a private method is refused on another object", () => S4.prototype.run.call({}));
var _x5 = new WeakMap();
const make5 = Base => class extends Base { constructor(o) { super(o); _classPrivateFieldInitSpec(this, _x5, 1); } };
class R5 { constructor(o) { return o; } }
class S5 extends make5(R5) {}
const o5 = {};
new S5(o5);
show("an object gets the field twice", () => { new S5(o5); return "twice"; });
