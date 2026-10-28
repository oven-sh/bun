// A regular expression made at run time, with a run that has no upper bound, asked of a subject in which such a run begins at many places of one stretch (fuzz/patterns-made-at-run-time-whose-runs-begin-at-many-places-of-one-stretch.ts), forty cases to a program. A run takes a share of the programs.
import { programOf, programs } from "./fuzz/patterns-made-at-run-time-whose-runs-begin-at-many-places-of-one-stretch";
import { generated } from "./generated/run-generated";

generated(
  "patterns made at run time whose runs begin at many places of one stretch",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 100 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
