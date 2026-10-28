// A file hands a variable of its top level to a function of another file that returns closures over its arguments, and code of the file that never runs reads the variable too (fuzz/a-variable-of-a-file-is-handed-to-a-factory-and-read-again-by-code-that-never-runs.ts), one case to a program. A run takes a share of the programs.
import {
  programOf,
  programs,
} from "./fuzz/a-variable-of-a-file-is-handed-to-a-factory-and-read-again-by-code-that-never-runs";
import { generated } from "./generated/run-generated";

generated(
  "a variable of a file is handed to a factory and read again by code that never runs",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 250 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: another reader of the variable makes it another program.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
