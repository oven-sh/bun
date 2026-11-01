// Babel 7.23 and after ends the function around a class with `return _createClass(B, [..])`. The name of the class stands nowhere but as that argument: its instances still have a layout, so a turn looks no name up.
// COUNT: arrivals <= 60
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
var seen = 0;
var Stored = (function () {
  function Stored(a) { this.a = a; this.b = 2; }
  return _createClass(Stored, [{ key: "a", get: function get() { return 1; }, set: function set(value) { seen += value; } }]);
})();
var Called = (function () {
  function Called(a) { this.a = a; this.b = 2; }
  return _createClass(Called, [{ key: "sum", value: function sum() { return this.a + this.b; } }], [{ key: "of", value: function of(a) { return new Called(a); } }]);
})();
var Read = (function () {
  function Read(a) { this.a = a; }
  return _createClass(Read, [{ key: "twice", get: function get() { return this.a * 2; } }]);
})();
function turn(i) {
  var stored = new Stored(i & 7);
  var called = new Called(i & 3);
  var read = new Read(i & 1);
  return stored.a + stored.b + called.sum() + read.twice;
}
var sum = 0;
for (var i = 0; i < 3000; i++) sum += turn(i);
console.log(sum, seen, Called.of(2).sum());
console.log(Object.keys(new Stored(1)).join(), Object.keys(new Called(1)).join(), Object.getOwnPropertyNames(Called.prototype).join(), Object.getOwnPropertyNames(Called).join());
console.log(Object.getOwnPropertyDescriptor(Called, "prototype").writable, new Called(1) instanceof Called, Called.name, Stored.length);
