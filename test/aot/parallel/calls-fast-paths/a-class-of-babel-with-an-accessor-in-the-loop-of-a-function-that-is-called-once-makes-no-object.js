// A class with a method and an accessor as Babel 7.24 writes it, its helpers in the file, made and read in the one loop of a function that is called once: main(), run(), the body of a test.
// No object is made, whether turn() stays a call or is copied into the loop: copied in, the object had four places where it would have to be made again, and was made every turn.
// Alone: what the compiler knows of a method goes by all that the executable holds, and with it what is counted here
// COUNT: cells <= 60
// COUNT: branches <= 90000
// COUNT: arrivals <= 40
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var B = /*#__PURE__*/function () {
  function B(a) {
    _classCallCheck(this, B);
    this.a = a;
    this.b = 2;
  }
  return _createClass(B, [{
    key: "sum",
    value: function sum() {
      return this.a + this.b;
    }
  }, {
    key: "twice",
    get: function get() {
      return this.a * 2;
    }
  }]);
}();
function turn(i) {
  const v = new B(i & 7);
  return v.sum() + v.twice;
}
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i);
  return sum;
}
console.log(bench(+(process.argv[2] ?? 20000)));
