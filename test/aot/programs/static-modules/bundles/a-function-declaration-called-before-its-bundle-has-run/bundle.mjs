var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.f = function(x) {
    return x + 1;
  };
});
export function run(x) {
  return require_m0().f(x);
}
