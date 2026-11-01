// What Babel writes for ES modules with @babel/plugin-transform-runtime: the helpers are default imports of files of @babel/runtime, which the conditions of the package lead to its CommonJS files. Each member still stands beside its class. What a turn still looks up by name: the field that an accessor of the prototype hides, once.
// COUNT: arrivals <= 3100
import _classCallCheck from "@babel/runtime/helpers/classCallCheck";
import _createClass from "@babel/runtime/helpers/createClass";
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
console.log(Object.getOwnPropertyDescriptor(Called, "prototype").writable, new Called(1) instanceof Called, Called.name, Stored.length);
try {
  Called(1);
} catch (error) {
  console.log(error.name, error.message);
}
