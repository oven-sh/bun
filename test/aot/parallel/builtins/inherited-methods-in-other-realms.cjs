// Functions of another realm, and code that runs there.
const vm = require("vm");
const log = console.log;
const attempt = (what, run) => {
  try { log(what, run()); } catch (error) { log(what, error.name); }
};
const context = vm.createContext({});
const max = vm.runInContext("Math.max", context);
const from = vm.runInContext("Array.from", context);
const list = vm.runInContext("Array", context);
for (const f of [max, from, list]) {
  attempt("its own value", () => Object.defineProperty(f, "call", { value: f.call }) === f);
  attempt("Reflect", () => Reflect.defineProperty(f, "apply", { value: f.apply, configurable: true }));
  log(Object.hasOwn(f, "call"), Object.hasOwn(f, "apply"), f.call === Function.prototype.call, f.call === Object.getPrototypeOf(f).call);
}
log(max.call(null, 1, 4), max.apply(null, [2, 3]), from.call(list, "ab").join(), list.apply(null, [1, 2]).length);
attempt("code there", () => vm.runInContext(`
  Object.defineProperty(JSON.stringify, "call", { value: JSON.stringify.call });
  Object.defineProperties(Object.keys, { apply: { value: Object.keys.apply, enumerable: true }, bind: { value: Function.prototype.bind } });
  [JSON.stringify.call(null, [1]), Object.keys.apply(null, [{ a: 1 }]).join(), Object.hasOwn(JSON.stringify, "call"), Object.keys(Object.keys).join(), Object.keys.bind(null, { b: 1 })().join()].join(" ");
`, context));
log(Object.hasOwn(JSON.stringify, "call"), Object.hasOwn(Object.keys, "apply"));
let sum = 0;
for (let i = 0; i < 3000; ++i) sum += max.call(null, i, 5) + Math.max.call(null, i, 7);
log(sum);
