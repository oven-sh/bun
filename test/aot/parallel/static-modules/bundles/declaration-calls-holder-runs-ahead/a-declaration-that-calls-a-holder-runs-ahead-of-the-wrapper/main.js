// The wrapper stands behind other code of the file, and a function declaration that calls a holder runs ahead of the holder's definition.
function lazy() {
  return require_a().a + require_b().b;
}
function attempt() {
  try {
    return lazy();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(attempt());
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.a = 1;
});
console.log(attempt());
var require_b = __commonJS((exports) => {
  exports.b = require_a().a + 1;
});
console.log(attempt(), require_b().b);
