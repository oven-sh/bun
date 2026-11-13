// The lines of signal-exit with a plain store, in a file that is required inside a function.
function load() {
  return require("./dep.cjs");
}
console.log(load().same());
