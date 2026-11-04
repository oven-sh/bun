var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var x = require_inner();
console.log("body: queueMicrotask", x);
queueMicrotask(() => console.log("job: queueMicrotask"));
export { x };
