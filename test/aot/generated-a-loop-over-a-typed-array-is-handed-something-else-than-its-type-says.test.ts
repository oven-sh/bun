// A function goes over a parameter that is declared as a typed array, and a JavaScript file hands it something else (fuzz/a-loop-over-a-typed-array-is-handed-something-else-than-its-type-says.ts), twelve cases to a program. A run takes a share of the programs.
import {
  flagsOf,
  programOf,
  programs,
} from "./fuzz/a-loop-over-a-typed-array-is-handed-something-else-than-its-type-says";
import { generated } from "./generated/run-generated";

generated(
  "a loop over a typed array is handed something else than its type says",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 100 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
