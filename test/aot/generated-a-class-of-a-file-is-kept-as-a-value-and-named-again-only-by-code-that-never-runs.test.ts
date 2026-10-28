// A file's own body puts a class of its top level into something as a value, and the only other naming of the class stands in code that never runs (fuzz/a-class-of-a-file-is-kept-as-a-value-and-named-again-only-by-code-that-never-runs.ts), one case to a program. A run takes a share of the programs.
import {
  programOf,
  programs,
} from "./fuzz/a-class-of-a-file-is-kept-as-a-value-and-named-again-only-by-code-that-never-runs";
import { generated } from "./generated/run-generated";

generated(
  "a class of a file is kept as a value and named again only by code that never runs",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 250 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: another naming of the class makes it another program.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
