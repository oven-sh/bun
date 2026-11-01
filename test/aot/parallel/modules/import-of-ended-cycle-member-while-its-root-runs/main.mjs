// require() runs a cycle of two. While the member that was entered first still runs, a third module calls import() on the other member, whose body has ended: that promise waits as it does under `bun run`. An import() of the same member behind the cycle is fulfilled.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 2
require("./root.mjs");
console.log("main ends");
export {};
