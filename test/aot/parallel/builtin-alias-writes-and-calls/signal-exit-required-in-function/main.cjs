// The first lines of the package signal-exit in a CommonJS module that is required inside a function.
function load() {
  return require("./dep.cjs");
}
console.log(load().same());
