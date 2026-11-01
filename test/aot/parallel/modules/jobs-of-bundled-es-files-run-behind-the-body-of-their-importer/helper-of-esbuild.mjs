var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    return (mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports);
  };
var require_inner = __commonJS({
  "src/inner.js"(exports, module) {
    module.exports = 7;
  },
});
var x = require_inner();
console.log("body: the helper of esbuild", x);
Promise.resolve().then(() => console.log("job: the helper of esbuild"));
export { x };
