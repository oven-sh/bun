// Babel 7.20.6 to 7.24.5: _defineProperties() sends the key of each member through _toPropertyKey(). A key that is written as a text or a number is what that makes of it, so each member stands beside its class and a turn looks no name up.
// COUNT: arrivals <= 60
function _typeof(obj) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); }
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? key : String(key); }
function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
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
