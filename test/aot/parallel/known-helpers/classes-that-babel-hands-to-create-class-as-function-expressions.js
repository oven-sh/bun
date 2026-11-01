// `var A = _createClass(function A() { .. })`, as Babel 7.24 and after writes a class without methods, and with lists of members behind it: the helper is written out there too, so the variable holds the function alone and what `new A()` makes is known.
// COUNT: arrivals <= 40
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var Plain = /*#__PURE__*/_createClass(function Plain(a) {
  _classCallCheck(this, Plain);
  this.a = a;
  this.b = 2;
});
function makeInner() {
  return /*#__PURE__*/_createClass(function Inner(a) {
    _classCallCheck(this, Inner);
    this.a = a;
  });
}
var Inner = makeInner();
var WithMembers = /*#__PURE__*/_createClass(function WithMembers(a) {
  _classCallCheck(this, WithMembers);
  this.a = a;
}, [{ key: "twice", get: function get() { return this.a * 2; } }], [{ key: "of", value: function of(a) { return new WithMembers(a); } }]);
function turn(i) {
  var plain = new Plain(i & 7);
  var inner = new Inner(i & 3);
  var withMembers = new WithMembers(i & 1);
  return plain.a + plain.b + inner.a + withMembers.twice;
}
var sum = 0;
for (var i = 0; i < 3000; i++) sum += turn(i);
console.log(sum, Plain.name, Plain.length, Inner.name, WithMembers.of(4).twice, Object.keys(new Plain(1)).join());
console.log(Object.getOwnPropertyDescriptor(Plain, "prototype").writable, new Plain(1) instanceof Plain, makeInner() === Inner, new (makeInner())(5).a);
try {
  Plain(1);
} catch (error) {
  console.log(error.name, error.message);
}
