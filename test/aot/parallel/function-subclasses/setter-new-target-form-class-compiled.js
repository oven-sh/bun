// `Reflect.construct(A, [], B)` runs A with an object below B.prototype. A setter there takes the store `this.v = ..`, so the object has no `v` of its own: it is not what `new A()` makes.
// the helper that Babel writes for a class compiled to ES5
function _createSuper(Derived) { return function () { var Super = Object.getPrototypeOf(Derived), NewTarget = Object.getPrototypeOf(this).constructor; return Reflect.construct(Super, arguments, NewTarget); }; }
function Base() { this.v = 1; this.name = "base"; }
function Derived() { return _super.apply(this, arguments); }
Object.setPrototypeOf(Derived, Base); Derived.prototype = Object.create(Base.prototype, { constructor: { value: Derived, writable: true, configurable: true } });
Object.defineProperty(Derived.prototype, "v", { set: function (x) { this._v = x * 2; }, get: function () { return this._v; }, configurable: true });
var _super = _createSuper(Derived);
var d = new Derived();
console.log("babel's form:", d.v, d._v, d.name, Object.keys(d).join());
