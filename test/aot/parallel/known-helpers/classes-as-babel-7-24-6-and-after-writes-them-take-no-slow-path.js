// Babel 7.24.6 and after: the helpers have one-letter names and run on commas, and the key of each member goes through _toPropertyKey(). A key that is written as a text or a number is what that makes of it, so each member stands beside its class and a turn looks no name up.
// COUNT: arrivals <= 60
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var seen = 0;
var Stored = /*#__PURE__*/function () {
  function Stored(a) { _classCallCheck(this, Stored); this.a = a; this.b = 2; }
  return _createClass(Stored, [{ key: "a", get: function get() { return 1; }, set: function set(value) { seen += value; } }]);
}();
var Called = /*#__PURE__*/function () {
  function Called(a) { _classCallCheck(this, Called); this.a = a; this.b = 2; }
  return _createClass(Called, [{ key: "sum", value: function sum() { return this.a + this.b; } }, { key: 7, value: function seven() { return 7; } }], [{ key: "of", value: function of(a) { return new Called(a); } }]);
}();
var Read = /*#__PURE__*/function () {
  function Read(a) { _classCallCheck(this, Read); this.a = a; }
  return _createClass(Read, [{ key: "twice", get: function get() { return this.a * 2; } }]);
}();
function turn(i) {
  var stored = new Stored(i & 7);
  var called = new Called(i & 3);
  var read = new Read(i & 1);
  return stored.a + stored.b + called.sum() + read.twice;
}
var sum = 0;
for (var i = 0; i < 3000; i++) sum += turn(i);
console.log(sum, seen, Called.of(2).sum(), new Called(1)[7](), new Called(1)["7"]());
console.log(Object.keys(new Stored(1)).join(), Object.keys(new Called(1)).join(), Object.getOwnPropertyNames(Called.prototype).join(), Object.getOwnPropertyNames(Called).join());
console.log(Object.getOwnPropertyDescriptor(Called, "prototype").writable, new Called(1) instanceof Called, Called.name, Stored.length, _typeof(1), _typeof(Symbol()));
try {
  Called(1);
} catch (error) {
  console.log(error.name, error.message);
}
