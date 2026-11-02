// No import() of the program is compiled. A function requires a second entry point, which requires a third module. That module calls import() on the second entry point from a text that the build did not read: the promise is fulfilled when the entry point has run.
// Entry points: ./running.mjs
function load() {
  return require("./running.mjs");
}
console.log("main loads, ended:", load().ended);
console.log("main ends");
export {};
