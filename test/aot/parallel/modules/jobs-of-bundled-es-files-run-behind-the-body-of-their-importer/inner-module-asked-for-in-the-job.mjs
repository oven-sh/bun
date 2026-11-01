var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var x = 7;
console.log("body: the inner module is asked for in the job", x);
Promise.resolve().then(() => console.log("job: the inner module is asked for in the job", require_inner()));
export { x };
