// A wrapper is called while the `var` of the wrapper that it calls is still undefined: a TypeError. The callback that threw is not run again, and the next call answers its exports as far as they had got.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.fromB = require_b().n;
});
var outcome;
try {
  require_a();
} catch (error) {
  outcome = error.constructor.name;
}
var require_b = __commonJS((exports) => {
  exports.n = 1;
});
console.log(outcome, require_a().fromB, require_b().n);
