// An object is changed, closed, copied, and the copy is written to (fuzz/writes-to-copies-of-changed-objects.ts): one kind of source, one change and one way to type it to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { nameOf, programOf, programs } from "./fuzz/writes-to-copies-of-changed-objects";
import { generated } from "./generated/run-generated";

generated(
  "writes to copies of changed objects",
  Array.from({ length: programs }, (_, index) => ({
    name: `${nameOf(index)}.`,
    isAlwaysRun: index % 100 === 0,
    isOnlyCompiled: true as const,
    make: () => programOf(index),
  })),
);
