var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var x = 7;
if (globalThis.nobodySetsThis) x = require_inner();
console.log("body: asked for in a branch never taken", x);
Promise.resolve().then(() => console.log("job: asked for in a branch never taken"));
export { x };
