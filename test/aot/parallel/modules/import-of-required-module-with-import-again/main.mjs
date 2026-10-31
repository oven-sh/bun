// require() runs a module that imports another one. It requires a third module, which calls import() on the first. Later a fourth module calls import() on the first inside another require(): that promise is fulfilled too.
require("./running.mjs");
console.log("main goes on");
require("./imports-later.mjs");
console.log("main ends");
export {};
