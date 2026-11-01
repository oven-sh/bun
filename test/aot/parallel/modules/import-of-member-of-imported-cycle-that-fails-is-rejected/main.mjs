// import() runs a cycle of two, with no require(). The member that was entered first calls import() on the other, whose body has ended, and then throws: both promises are rejected with what it threw.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 1
import("./throws.mjs").then(
  () => console.log("import of throws: fulfilled"),
  error => console.log("import of throws: rejected,", error.message),
);
console.log("main ends");
