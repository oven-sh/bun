// Three modules import each other in a ring. A require() evaluates one of them for good before the ring is entered, so the member behind it leads to no module that still runs: it is evaluated when its own body ends. The module that was entered first throws behind that: an import() of the member is fulfilled, then and later.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 2
import("./first.mjs").then(
  () => console.log("import of first: fulfilled"),
  error => {
    console.log("import of first: rejected,", error.message);
    return import("./behind.mjs").then(
      () => console.log("later import of behind: fulfilled"),
      later => console.log("later import of behind: rejected,", later.message),
    );
  },
);
console.log("main ends");
