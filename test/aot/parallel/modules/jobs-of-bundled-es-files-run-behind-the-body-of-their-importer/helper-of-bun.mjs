var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var x = require_inner();
console.log("body: the helper of Bun", x);
Promise.resolve().then(() => console.log("job: the helper of Bun"));
export { x };
