// An object that nothing else holds is the source of a copy, and an object made in the same way reaches code that nobody follows (fuzz/a-fresh-object-is-the-source-of-a-copy.ts), one case to a program. A run takes a share of the programs.
import { flagsOf, programOf, programs } from "./fuzz/a-fresh-object-is-the-source-of-a-copy";
import { generated } from "./generated/run-generated";

generated(
  "a fresh object is the source of a copy",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 300 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
