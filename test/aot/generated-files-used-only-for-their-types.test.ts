// The entry point takes types alone from another file (fuzz/files-used-only-for-their-types.ts), twenty cases to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "./fuzz/files-used-only-for-their-types";
import { generated } from "./generated/run-generated";

generated(
  "files used only for their types",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 30 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: what a run puts there are values, and a file of this family is taken for its types alone.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
