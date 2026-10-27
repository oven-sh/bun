// Fixed seeds of fuzz/ticks-and-jobs-that-imported-files-queue-while-their-graph-is-loaded.ts: imported files queue ticks, promise jobs and timers while their graph is loaded, and
// everything says when it runs. Where plain Bun runs a tick hangs on when its loader has read the other files, so there is no one order to follow (docs/compiler/compatibility.mdx).
// An executable prints the lines of plain Bun: in the same order, or in the order that is written down in generated/<the same name>.json.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/ticks-and-jobs-that-imported-files-queue-while-their-graph-is-loaded";
import { generated } from "./generated/run-generated";
import orders from "./generated/ticks-and-jobs-that-imported-files-queue-while-their-graph-is-loaded.json";

generated(
  "ticks and jobs that imported files queue while their graph is loaded",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: what is queued where is the point.
    keepsItsText: true as const,
    // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
    plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
    printsInThisOrder: (orders as Record<string, string[]>)[index + 1],
    make: () => generate(new Random(index + 1)),
  })),
);
