(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? factory(exports, "commonjs")
    : typeof define === "function" && define.amd
      ? define(["exports"], factory)
      : ((global = typeof globalThis !== "undefined" ? globalThis : global || self), factory((global.umd = {}), "global"));
})(this, function (exports, kind) {
  "use strict";
  exports.kind = kind;
  exports.add = (a, b) => a + b;
});
