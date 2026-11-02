var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var x = require_inner();
console.log("body: behind an await", x);
(async () => {
  await null;
  console.log("job: behind an await");
})();
export { x };
