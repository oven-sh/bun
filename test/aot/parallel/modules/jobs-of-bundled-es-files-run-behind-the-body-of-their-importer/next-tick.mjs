var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var x = require_inner();
console.log("body: process.nextTick", x);
process.nextTick(() => console.log("job: process.nextTick"));
export { x };
