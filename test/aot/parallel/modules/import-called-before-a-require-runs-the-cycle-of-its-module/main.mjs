// A module calls import() on a member of a cycle of five and then requires the module of the cycle that is entered first, so the loader goes through the cycle before any of it runs. One member is imported by a single member and by nothing else, and calls import() on a member whose body has ended. Each import() is fulfilled behind the cycle, as under `bun run`.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 4
await import("./outer.mjs");
await new Promise(resolve => setImmediate(resolve));
console.log("main ends");
