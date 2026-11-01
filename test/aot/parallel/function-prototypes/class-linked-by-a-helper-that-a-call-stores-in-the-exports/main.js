// As a compiler writes a class for old engines with its helpers taken out of a package: the package has the form that works under every loader, and the names of its
// exports are arguments of a function that stores. The build sees what lies under `extend`, so B has a layout below that of A and the loop looks nothing up.
// COUNT: arrivals <= 16
// COUNT: cells <= 10
"use strict";
var helpers = require("helpers");
var A = (function () {
  function A() {
    this.z = 1;
  }
  A.prototype.base = function base() {
    return this.z;
  };
  return A;
})();
var B = (function (_super) {
  helpers.extend(B, _super);
  function B(a) {
    var _this = _super.call(this) || this;
    _this.a = a;
    _this.b = 2;
    return _this;
  }
  return B;
})(A);
function turn(i) {
  var v = new B(i);
  return v.a + v.b + v.base();
}
var total = 0;
for (var i = 0; i < 1000; i++) total += turn(i & 7);
console.log(total, new B(1) instanceof A, Object.getPrototypeOf(B) === A);
