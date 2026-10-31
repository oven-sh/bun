// require() runs a module of a cycle of two. The other member requires a third module, which calls import() on that member while it runs. Behind that the first member calls import() on it again: this promise is fulfilled when the cycle has run.
// Todo: The later import() stays pending in an executable and its line is never printed. The record of the member names the member itself as the root of its cycle, so the later import() gets the promise that the first one left pending.
require("./first.mjs");
console.log("main ends");
export {};
