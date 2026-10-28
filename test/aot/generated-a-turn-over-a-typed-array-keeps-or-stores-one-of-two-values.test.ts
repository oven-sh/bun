// A loop goes over a typed array, and a test in every turn chooses between two values: the least or the greatest so far is kept, or one of two values is stored (fuzz/a-turn-over-a-typed-array-keeps-or-stores-one-of-two-values.ts), twenty cases to a program. A run takes a share of the programs.
import { flagsOf, programOf, programs } from "./fuzz/a-turn-over-a-typed-array-keeps-or-stores-one-of-two-values";
import { generated } from "./generated/run-generated";

generated(
  "a turn over a typed array keeps or stores one of two values",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 650 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
