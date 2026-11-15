// The second parameter of a callback is `{ exports }` and nothing else: a store of another property and a list of its keys see a plain object.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports, module) => {
  module.exports = function f() {};
  module.exports.member = 1;
  module.id = "mine";
  globalThis.keysOfModule = Object.keys(module).join();
});
console.log(typeof require_a(), require_a().member, globalThis.keysOfModule);
