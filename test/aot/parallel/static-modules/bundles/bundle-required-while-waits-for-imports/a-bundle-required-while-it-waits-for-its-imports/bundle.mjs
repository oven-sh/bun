import "./leaf.mjs";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.f = (x) => x + 1;
});
export function run(x) {
  return require_a().f(x);
}
