// No import() of the program is compiled. require() runs a second entry point, which imports a module and requires a third one. That one calls import() on the second entry point from a text that the build did not read: the promise is fulfilled when the entry point has run.
// Entry points: ./running.mjs
// Todo: The promise stays pending in an executable and its line is never printed. With no import() to see, the build makes the require() of running.mjs a call of its start, and nothing settles the promise when that start returns.
require("./running.mjs");
console.log("main ends");
export {};
