// As a compiler writes a class for old engines: the helper that links the classes lies in a package, comes through a function that answers it or wraps it,
// and is called behind `(0, ..)`. The build sees which function that is, so B has a layout below that of A and the loop looks nothing up.
// COUNT: arrivals <= 12
// COUNT: cells <= 5
"use strict";
var interop = require("helpers/interop.js");
var inherits = interop(require("helpers/inherits.js"));
var A = (function () {
  function A() {
    this.z = 1;
  }
  A.prototype.base = function base() {
    return this.z;
  };
  return A;
})();
var B = (function (_A) {
  function B(a) {
    var _this;
    _this = _A.call(this) || this;
    _this.a = a;
    _this.b = 2;
    return _this;
  }
  (0, inherits["default"])(B, _A);
  return B;
})(A);
function turn(i) {
  var v = new B(i);
  return v.a + v.b + v.base();
}
var total = 0;
for (var i = 0; i < 1000; i++) total += turn(i & 7);
console.log(total, new B(1) instanceof A, Object.getPrototypeOf(B) === A);
