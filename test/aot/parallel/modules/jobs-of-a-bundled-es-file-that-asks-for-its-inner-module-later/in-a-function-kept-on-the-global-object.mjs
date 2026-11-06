var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
globalThis.kept = function () {
  return require_inner();
};
export const kept = 1;
console.log("body: in a function kept on the global object");
Promise.resolve().then(() => console.log("job: in a function kept on the global object"));
