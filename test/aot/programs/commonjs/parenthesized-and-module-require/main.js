// `(require)("./one.cjs")` and `module.require("./two.cjs")` are the module's own `require`: the files they name are compiled with the program. A parameter by the name `require` or `module` is not.
console.log((require)("./one.cjs").n, ((require))("./one.cjs").n);
console.log(module.require("./two.cjs").n);
const { n } = module.require("./two.cjs");
function later() {
  return module.require("./three.cjs").n + (require)("./three.cjs").n;
}
console.log(n, later());
const held = module.require("./held.cjs");
console.log(held.n, Object.keys(held).join());
console.log(module.require(n === 2 ? "./one.cjs" : "./two.cjs").n);
function withItsOwnModule(module) {
  return module.require("./one.cjs");
}
console.log(withItsOwnModule({ require: name => "mine: " + name }));
function withItsOwnRequire(require) {
  return (require)("./one.cjs");
}
console.log(withItsOwnRequire(name => "mine: " + name));
