(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : (global = global || self, factory(global.shelf = {}));
})(this, function (exports) {
  "use strict";
  function plus(a, b) { return (a + b) | 0; }
  function times(a, b) { return Math.imul(a, b); }
  exports.plus = plus;
  exports.times = times;
  Object.defineProperty(exports, "__esModule", { value: true });
});
