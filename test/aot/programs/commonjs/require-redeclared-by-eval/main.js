// A sloppy direct eval can declare `var require` or `var module` in the function that calls it, and the calls after it reach the new value. Without such a declaration they load the file they name. Plain Bun rewrites `module.require("..")` and `require?.("..")` to a load when it transpiles, whatever the names mean at run time, so the output is stored.
const ownRequire = "var require = name => 'own: ' + name";

function load(source) {
  eval(source);
  return require("./one.cjs");
}
console.log(load("").n, load("var other = 1").n);
console.log(load(ownRequire));

function loadThroughModule(source) {
  eval(source);
  return module.require("./one.cjs");
}
console.log(loadThroughModule("").n);
console.log(loadThroughModule("var module = { owner: 'own', require(name) { return this.owner + ': ' + name; } }"));

function resolve(source) {
  eval(source);
  return require.resolve("./one.cjs");
}
console.log(typeof resolve(""));
console.log(resolve("var require = { resolve: name => 'own: ' + name }"));

function loadLater(source) {
  eval(source);
  return () => require("./one.cjs");
}
console.log(loadLater("")().n);
console.log(loadLater(ownRequire)());

function declareInArgument() {
  const loaded = require((eval(ownRequire), "./one.cjs"));
  return [loaded.n, require("./one.cjs")];
}
console.log(declareInArgument().join());

function loadComputed(source, name) {
  eval(source);
  return require(name);
}
console.log(loadComputed("", "./one.cjs").n);
console.log(loadComputed(ownRequire, "./one.cjs"));

function loadIfPresent(source) {
  eval(source);
  return require?.("./one.cjs");
}
console.log(loadIfPresent("").n);
console.log(loadIfPresent("var require = null"));

function loadMissing(source) {
  eval(source);
  try {
    return require("./missing.cjs");
  } catch (error) {
    return error.code;
  }
}
console.log(loadMissing(""));
console.log(loadMissing(ownRequire));
