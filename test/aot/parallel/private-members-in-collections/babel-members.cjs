// STATISTIC: KnownHelperCalls >= 24
// Private members as Babel 7.24 and after writes them: WeakMaps and WeakSets behind helpers.
function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
function _classPrivateMethodInitSpec(e, a) { _checkPrivateRedeclaration(e, a), a.add(e); }
function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); }
function _classPrivateFieldGet2(s, a) { return s.get(_assertClassBrand(s, a)); }
function _classPrivateFieldSet2(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }
function _classPrivateGetter(s, r, a) { return a(_assertClassBrand(s, r)); }
function _classPrivateSetter(s, r, a, t) { return r(_assertClassBrand(s, a), t), t; }
function _checkInRHS(e) { if (Object(e) !== e) throw TypeError("right-hand side of 'in' should be an object, got " + (null !== e ? typeof e : "null")); return e; }
var log = [];
function attempt(f) { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } }
var _total = /*#__PURE__*/new WeakMap();
var _step = /*#__PURE__*/new WeakMap();
var _Counter_brand = /*#__PURE__*/new WeakSet();
class Counter {
  constructor(step) {
    _classPrivateMethodInitSpec(this, _Counter_brand);
    _classPrivateFieldInitSpec(this, _total, 0);
    _classPrivateFieldInitSpec(this, _step, void 0);
    _classPrivateFieldSet2(_step, this, step);
  }
  add(times) {
    for (let i = 0; i < times; i++) _assertClassBrand(_Counter_brand, this, _once).call(this);
    return _classPrivateFieldGet2(_total, this);
  }
  get double() { return _classPrivateGetter(_Counter_brand, this, _get_twice); }
  set total(v) { _classPrivateSetter(_Counter_brand, _set_total, this, v); }
  bump() { var _this$total, _this$total2; return _classPrivateFieldSet2(_total, this, (_this$total = _classPrivateFieldGet2(_total, this), _this$total2 = _this$total++, _this$total)), _this$total2; }
  static is(o) { return _total.has(_checkInRHS(o)) && _Counter_brand.has(_checkInRHS(o)); }
  static peek(o) { return _classPrivateFieldGet2(_total, o); }
  static poke(o, v) { return _classPrivateFieldSet2(_total, o, v); }
  static again(o) { _classPrivateFieldInitSpec(o, _total, 5); }
  static brand(o) { return _classPrivateMethodInitSpec(o, _Counter_brand); }
  static twice(o) { return _classPrivateGetter(_Counter_brand, o, _get_twice); }
  static assert(o) { return _assertClassBrand(_Counter_brand, o) === o; }
}
function _once() { _classPrivateFieldSet2(_total, this, _classPrivateFieldGet2(_total, this) + _classPrivateFieldGet2(_step, this)); }
function _get_twice(_this) { return _classPrivateFieldGet2(_total, _this) * 2; }
function _set_total(_this2, v) { _classPrivateFieldSet2(_total, _this2, v); }
class Below extends Counter { constructor() { super("b"); this.own = 1; } }
var a = new Counter(2), b = new Below();
attempt(() => a.add(3));
attempt(() => b.add(2));
attempt(() => a.double);
attempt(() => (a.total = 40, a.add(1)));
attempt(() => [a.bump(), a.bump(), Counter.peek(a)]);
for (const o of [a, b, {}, [], () => 1, Counter, Counter.prototype, Object.create(a), new Proxy(a, {}), 1, "s", null, undefined, Symbol.iterator, 1n]) {
  attempt(() => Counter.is(o));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.poke(o, 7));
  attempt(() => Counter.twice(o));
  attempt(() => Counter.assert(o));
}
attempt(() => Counter.again(a));
attempt(() => Counter.peek(a));
attempt(() => Counter.again(a));
attempt(() => Counter.brand(a));
var other = {}, frozen = Object.freeze({ x: 1 }), proxy = new Proxy({}, { defineProperty() { log.push("trap"); return false; }, has() { log.push("has"); return true; } });
for (const o of [other, frozen, proxy, 5, "t", null]) {
  attempt(() => Counter.again(o));
  attempt(() => Counter.again(o));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.poke(o, "new"));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.is(o));
  attempt(() => Counter.brand(o));
  attempt(() => Counter.is(o));
}
attempt(() => Counter.prototype.add.call(other, 1));
attempt(() => [Object.keys(a), Reflect.ownKeys(b), JSON.stringify(other), Object.getOwnPropertySymbols(other).length]);
var copies = [Object.assign({}, a), { ...a }, structuredClone({ ...b })];
for (const o of copies) attempt(() => Counter.is(o));
class Returns { constructor(o) { return o; } }
var _late = /*#__PURE__*/new WeakMap();
class Late extends Returns { constructor(o) { super(o); _classPrivateFieldInitSpec(this, _late, "late"); } static of(o) { return _classPrivateFieldGet2(_late, o); } }
var plain = { p: 1 };
attempt(() => new Late(plain) === plain);
attempt(() => Late.of(plain));
attempt(() => new Late(plain));
attempt(() => Late.of(new Late(a)));
attempt(() => Late.of({}));
for (let i = 0, sum = 0; i < 400; i++) { var c = new Counter(i & 3); sum += c.add(2) + c.double; if (i === 399) log.push(sum); }
console.log(log.join("\n"));
