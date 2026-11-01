var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  Promise.resolve().then(() => console.log("job: queued by the inner module"));
  module.exports = 7;
});
var x = require_inner();
console.log("body: queued by the inner module", x);
export { x };
