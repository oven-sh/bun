// A chain of CommonJS files as `bun build` bundles them: each `__commonJS(callback)` is a module, and each `require_x()` a require.
// STATISTIC: ModulesWithNames >= 3
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// m0.js
var require_m0 = __commonJS((exports) => {
  exports.c = 1;
  exports.f = function(x) {
    return x + exports.c;
  };
});

// m1.js
var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});

// m2.js
var require_m2 = __commonJS((exports) => {
  var a = require_m1();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});

// main.js
var a = require_m2();
console.log(a.f(2), a.f(1));
