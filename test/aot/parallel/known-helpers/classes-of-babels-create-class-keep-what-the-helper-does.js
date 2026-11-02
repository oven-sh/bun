// The helpers that Babel writes for a class, called with lists written out, do what their text does: members of both sides, accessors, what a descriptor says of itself, a helper that the program replaces, and a prototype that takes no more members.
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
function show(object) {
  return Object.getOwnPropertyNames(object).sort().map(name => {
    const d = Object.getOwnPropertyDescriptor(object, name);
    return name + ":" + ("value" in d ? typeof d.value : "accessor") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : "");
  }).join(",");
}
var A = (function () {
  function A(x) { this.x = x; }
  var returned = _createClass(A, [{ key: "get", value: function get() { return this.x + 1; } }, { key: "size", get: function get() { return this.x * 2; }, set: function set(v) { this.x = v; } }, { key: "shown", enumerable: true, value: function shown() { return "A"; } }], [{ key: "make", value: function make(x) { return new A(x); } }]);
  console.log(returned === A);
  return A;
})();
var B = (function () {
  function B() {}
  _createClass(B, null, [{ key: "only", value: 3 }]);
  return B;
})();
var C = (function () {
  function C() {}
  _createClass(C, [{ key: "get", value: function get() { return "C"; } }]);
  return C;
})();
const a = A.make(4);
a.size = 5;
console.log(a.get(), a.size, a.shown(), B.only, new C().get());
for (const object of [A.prototype, A, B.prototype, B, C.prototype]) console.log(show(object));
for (const key in a) console.log("seen", key);

var makes = _createClass;
_createClass = function (Constructor) { Constructor.prototype.replaced = true; return Constructor; };
var F = (function () {
  function F() {}
  _createClass(F, [{ key: "never", value: function never() {} }]);
  return F;
})();
_createClass = makes;
console.log(new F().replaced, typeof new F().never);
try {
  var G = (function () {
    function G() {}
    Object.freeze(G.prototype);
    _createClass(G, [{ key: "stopped", value: function stopped() {} }]);
    return G;
  })();
} catch (error) {
  console.log(error.constructor.name);
}
