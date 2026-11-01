// require() runs a module of a cycle of two. The other member requires a third module, which calls import() on that member while it runs. Behind that the first member calls import() on it again: this promise is fulfilled when the cycle has run.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 2
require("./first.mjs");
console.log("main ends");
export {};
