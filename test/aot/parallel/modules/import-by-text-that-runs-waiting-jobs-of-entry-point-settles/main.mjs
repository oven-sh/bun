// No import() of the program is compiled. require() runs a second entry point, whose text calls import() on that entry point and runs the waiting jobs itself: the promise is fulfilled when the entry point has run.
// Entry points: ./running.mjs
require("./running.mjs");
console.log("main ends");
export {};
