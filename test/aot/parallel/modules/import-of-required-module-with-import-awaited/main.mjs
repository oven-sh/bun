// require() runs a module that imports another one. It requires a third module, in which an async function awaits import() of the first. The function continues when the first module has run.
require("./running.mjs");
console.log("main ends");
export {};
