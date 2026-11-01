// require() runs a module that imports another one and requires a second module of that kind. A file that the second one requires calls import() on both. Each promise is fulfilled when its module has run.
require("./outer.mjs");
console.log("main ends");
export {};
