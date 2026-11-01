// require() runs a module that has no code of its own: it imports one module for later and one whose body requires a third module, which calls import() on the first. The promise is fulfilled when the first module has run.
require("./running.mjs");
console.log("main ends");
export {};
