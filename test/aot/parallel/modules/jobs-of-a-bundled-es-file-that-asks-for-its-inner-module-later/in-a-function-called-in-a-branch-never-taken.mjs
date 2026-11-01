var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
function ask() {
  return require_inner();
}
export var branch = 7;
if (globalThis.nobodySetsThis) branch = ask();
console.log("body: in a function called in a branch never taken");
Promise.resolve().then(() => console.log("job: in a function called in a branch never taken"));
