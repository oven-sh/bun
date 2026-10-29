// The wrappers of esbuild 0.14 to 0.27: the function is the one member of a literal, and the helper finds it by Object.getOwnPropertyNames. Each is a module of its own.
// STATISTIC: ModulesWithNames >= 3
// STATISTIC: RequireSitesBound >= 5
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// a.js
var require_a = __commonJS({
  "a.js"(exports) {
    exports.a = 1;
    exports.twice = function (x) {
      return x * 2;
    };
  }
});

// b.js
var require_b = __commonJS({
  "b.js"(exports, module) {
    var a = require_a();
    module.exports = { b: a.a + 1, call: (x) => a.twice(x) };
  }
});

// c.js
var require_c = __commonJS({
  "c.js"(exports) {
    var b = require_b();
    exports.c = b.b + b.call(3);
  }
});

// main.js
var c = require_c();
console.log(c.c, require_b().b, require_a().twice(21));
