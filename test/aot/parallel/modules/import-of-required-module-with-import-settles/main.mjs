// require() runs a module that imports another one. It requires a third module, which calls import() on the first. The promise is fulfilled when the first module has run.
// STATISTIC: ModulesWithState = 1
require("./running.mjs");
console.log("main ends");
export {};
