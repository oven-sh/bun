// A wrapper that is also held as a value, put into an array and called with an argument.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.n = 1;
});
var held = require_a;
console.log(held().n, [require_a].map(wrapper => wrapper().n).join(), require_a(1).n, require_a() === held());
