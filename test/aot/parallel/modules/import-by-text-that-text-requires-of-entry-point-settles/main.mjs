// No import() of the program is compiled. require() runs a second entry point, whose text makes a require() for itself and requires a third entry point. The text there calls import() on the second one: the promise is fulfilled when that entry point has run.
// Entry points: ./running.mjs ./other.mjs
require("./running.mjs");
console.log("main ends");
export {};
