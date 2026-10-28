// A loop adds something of every element of a typed array to a variable, from starts of every kind and at many lengths (fuzz/the-elements-of-a-typed-array-are-added-up-from-every-start.ts), twenty cases to a program. A run takes a share of the programs.
import { flagsOf, programOf, programs } from "./fuzz/the-elements-of-a-typed-array-are-added-up-from-every-start";
import { generated } from "./generated/run-generated";

generated(
  "the elements of a typed array are added up from every start",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 660 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
