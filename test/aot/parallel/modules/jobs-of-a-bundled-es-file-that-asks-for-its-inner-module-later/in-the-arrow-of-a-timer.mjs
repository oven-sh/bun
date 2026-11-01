var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
export const timed = 1;
setTimeout(() => console.log("timer: in the arrow of a timer", require_inner()), 0);
console.log("body: in the arrow of a timer");
Promise.resolve().then(() => console.log("job: in the arrow of a timer"));
