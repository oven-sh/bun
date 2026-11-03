// Two wrappers that call each other: the second call of the first answers its exports as far as they have got.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.early = 1;
  var b = require_b();
  exports.late = 2;
  exports.saw = b.saw;
});
var require_b = __commonJS((exports) => {
  var a = require_a();
  exports.saw = a.early + ":" + a.late;
  exports.later = () => a.early + ":" + a.late;
});
console.log(require_a().saw, require_b().later());
