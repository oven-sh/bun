// require() runs a module of a cycle of two. It requires a third module, which calls import() on the first. The promise is fulfilled when the first module has run.
require("./running.mjs");
console.log("main ends");
export {};
