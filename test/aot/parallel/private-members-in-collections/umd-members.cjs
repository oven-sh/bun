// STATISTIC: KnownHelperCalls >= 12
// Private members of ES5 classes as Babel writes them, in a bundle's function.
(function (factory) { factory({}); })(function (exports) {
  "use strict";
  function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
  function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
  function _classPrivateMethodInitSpec(e, a) { _checkPrivateRedeclaration(e, a), a.add(e); }
  function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); }
  function _classPrivateFieldGet2(s, a) { return s.get(_assertClassBrand(s, a)); }
  function _classPrivateFieldSet2(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }
  function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
  var log = [];
  function attempt(f) { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } }
  var _x = /*#__PURE__*/new WeakMap();
  var _brand = /*#__PURE__*/new WeakSet();
  var A = function () {
    function A(x) {
      _classCallCheck(this, A);
      _classPrivateMethodInitSpec(this, _brand);
      _classPrivateFieldInitSpec(this, _x, 0);
      _classPrivateFieldSet2(_x, this, x);
      this.open = x;
    }
    A.prototype.get = function get() { return _classPrivateFieldGet2(_x, this); };
    A.prototype.add = function add(n) { return _classPrivateFieldSet2(_x, this, _assertClassBrand(_brand, this, _sum).call(this, n)); };
    A.is = function is(o) { return _x.has(o) && _brand.has(o); };
    A.peek = function peek(o) { return _classPrivateFieldGet2(_x, o); };
    A.init = function init(o) { return _classPrivateFieldInitSpec(o, _x, 5); };
    return A;
  }();
  function _sum(n) { return _classPrivateFieldGet2(_x, this) + n; }
  var _y = /*#__PURE__*/new WeakMap();
  var B = function (_A) {
    function B(x) {
      var _this;
      _classCallCheck(this, B);
      _this = _A.call(this, x) || this;
      _classPrivateFieldInitSpec(_this, _y, x * 2);
      return _this;
    }
    B.prototype = Object.create(_A.prototype);
    B.prototype.constructor = B;
    B.prototype.both = function both() { return this.get() + _classPrivateFieldGet2(_y, this); };
    return B;
  }(A);
  var a = new A(3), b = new B(4);
  attempt(() => a.get());
  attempt(() => a.add(5));
  attempt(() => b.both());
  attempt(() => b.add("s"));
  attempt(() => b.both());
  attempt(() => B.prototype.both.call(a));
  for (const o of [a, b, {}, A, A.prototype, Object.create(b), new Proxy(a, {}), null, 1]) {
    attempt(() => A.is(o));
    attempt(() => A.peek(o));
  }
  attempt(() => A.init(a));
  attempt(() => A.peek(a));
  var o = Object.freeze({});
  attempt(() => A.init(o));
  attempt(() => A.peek(o));
  attempt(() => A.init(o));
  attempt(() => A(1));
  attempt(() => A.call(a, 1));
  attempt(() => Reflect.ownKeys(a).join() + Reflect.ownKeys(b).join());
  var sum = 0;
  for (var i = 0; i < 400; i++) { var c = new B(i & 7); sum += c.add(1) + c.both(); }
  log.push(sum);
  console.log(log.join("\n"));
});
