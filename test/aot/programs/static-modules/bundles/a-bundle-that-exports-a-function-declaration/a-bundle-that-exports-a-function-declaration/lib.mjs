import { one } from "./leaf.mjs";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.c = 1;
  exports.f = function(x) {
    return x + exports.c;
  };
});
var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
var require_m2 = __commonJS((exports, module) => {
  var a = require_m1();
  module.exports.c = a.c + 1;
  module.exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
export function run(x) { return require_m2().f(x) + one - 1; }
