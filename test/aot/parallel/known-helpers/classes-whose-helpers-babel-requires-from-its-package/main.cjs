// What Babel writes for CommonJS with @babel/plugin-transform-runtime, as most published packages have it: the helpers stand in files of @babel/runtime and are called as `(0, _createClass2["default"])(..)`. Each member still stands beside its class. What a turn of three constructions still looks up by name: `default` of the function that checks the call, three times, and the field that an accessor of the prototype hides, once.
// COUNT: arrivals <= 12100
"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));
var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));
var seen = 0;
var Stored = /*#__PURE__*/function () {
  function Stored(a) { (0, _classCallCheck2["default"])(this, Stored); this.a = a; this.b = 2; }
  return (0, _createClass2["default"])(Stored, [{ key: "a", get: function get() { return 1; }, set: function set(value) { seen += value; } }]);
}();
var Called = /*#__PURE__*/function () {
  function Called(a) { (0, _classCallCheck2["default"])(this, Called); this.a = a; this.b = 2; }
  return (0, _createClass2["default"])(Called, [{ key: "sum", value: function sum() { return this.a + this.b; } }, { key: 7, value: function seven() { return 7; } }], [{ key: "of", value: function of(a) { return new Called(a); } }]);
}();
var Read = /*#__PURE__*/function () {
  function Read(a) { (0, _classCallCheck2["default"])(this, Read); this.a = a; }
  return (0, _createClass2["default"])(Read, [{ key: "twice", get: function get() { return this.a * 2; } }]);
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
console.log(Object.getOwnPropertyDescriptor(Called, "prototype").writable, new Called(1) instanceof Called, Called.name, Stored.length);
try {
  Called(1);
} catch (error) {
  console.log(error.name, error.message);
}
