// What _toPropertyKey() of Babel 7.24.6 makes of each kind of key, written in the list and handed in: numbers, booleans, a function, symbols, objects with toString(), valueOf() and Symbol.toPrimitive, and the two that throw.
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var log = [];
var mark = Symbol("mark");
var keyed = { toString: function () { log.push("toString"); return "byText"; }, valueOf: function () { log.push("valueOf"); return "byValue"; } };
var primitive = {};
primitive[Symbol.toPrimitive] = function (hint) { log.push(hint); return "byMethod"; };
function make(key) {
  function Made() {}
  return _createClass(Made, [{ key: key, value: function value() { return "found"; } }]);
}
function names(Constructor) { return Reflect.ownKeys(Constructor.prototype).map(String).join(); }
console.log(names(make("text")), names(make(3)), names(make(-0)), names(make(1e21)), names(make(true)), names(make(null)), names(make(undefined)));
console.log(names(make(mark)), names(make(keyed)), names(make(primitive)), log.join());
var Written = function () {
  function Written() {}
  return _createClass(Written, [{ key: 1.5, value: function a() { return "a"; } }, { key: true, value: function b() { return "b"; } }, { key: "", value: function c() { return "c"; } }, { key: function named() {}, value: function d() { return "d"; } }]);
}();
console.log(JSON.stringify(Reflect.ownKeys(Written.prototype)), new Written()[1.5](), new Written()["true"](), new Written()[""]());
var BySymbol = function () {
  function BySymbol() {}
  return _createClass(BySymbol, [{ key: Symbol.iterator, value: function iterate() { return [1, 2][Symbol.iterator](); } }, { key: "plain", value: function plain() { return 3; } }]);
}();
console.log([].concat(Array.from(new BySymbol())).join(), new BySymbol().plain());
try {
  make({ toString: function () { return {}; }, valueOf: function () { return {}; } });
} catch (error) {
  console.log(error.name);
}
var bad = {};
bad[Symbol.toPrimitive] = function () { return {}; };
try {
  make(bad);
} catch (error) {
  console.log(error.name, error.message);
}
