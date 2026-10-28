import { programAlone, programWithRequire, shapesWithRequire } from "./generated/graphs-beside-a-chain-of-jobs";
import { generated } from "./generated/run-generated";

// The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

generated("graphs beside a chain of jobs", [
  {
    name: "nothing is required",
    isAlwaysRun: true,
    wasOnceWrong: true,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    plainEnv,
    make: programAlone,
  },
  ...shapesWithRequire.map(shape => ({
    name: `a require() comes into the graph before the loader does: ${shape}`,
    isAlwaysRun: true,
    wasOnceWrong: true,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    plainEnv,
    make: () =>
      programWithRequire(
        shape,
        Array.from({ length: 16 }, (_, turn) => turn),
      ),
  })),
]);
