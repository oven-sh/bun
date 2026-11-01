// require() runs a module whose import is a cycle of two. One member calls import() on the other, whose body has ended, and then throws: the promise is rejected with what it threw.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 1
try {
  require("./imports-cycle.mjs");
} catch (error) {
  console.log("require threw:", error.message);
}
console.log("main ends");
export {};
