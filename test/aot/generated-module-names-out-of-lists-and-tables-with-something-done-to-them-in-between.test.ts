// Fixed seeds of fuzz/module-names-out-of-lists-and-tables-with-something-done-to-them-in-between.ts: a list or a table holds names of files, something is done to it, which may change
// what it holds, and a loader is called with each name. An executable holds the files that are loaded and prints what plain Bun prints.
import { generate } from "./fuzz/module-names-out-of-lists-and-tables-with-something-done-to-them-in-between";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "module names out of lists and tables with something done to them in between",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first forty seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 40,
    isOnlyCompiled: true as const,
    // Which files an executable holds is the point: a neighbor might bring them.
    isBuiltAlone: true as const,
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
