// A file holds a declaration at its top level that nothing uses, and defining it throws or runs code (fuzz/a-declaration-that-nothing-uses-throws-or-runs-code-where-it-stands.ts), one case to a program. A run takes a share of the programs.
import { programOf, programs } from "./fuzz/a-declaration-that-nothing-uses-throws-or-runs-code-where-it-stands";
import { generated } from "./generated/run-generated";

generated(
  "a declaration that nothing uses throws or runs code where it stands",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 25 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: whatever names the declaration makes it one that is used.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
