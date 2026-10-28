// Two objects whose field holds values of different kinds arrive at one parameter (fuzz/objects-whose-field-is-stored-differently-arrive-at-one-parameter.ts), twenty cases to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "./fuzz/objects-whose-field-is-stored-differently-arrive-at-one-parameter";
import { generated } from "./generated/run-generated";

generated(
  "objects whose field is stored differently arrive at one parameter",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 300 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a second look at an object could tell the compiler what the first may not assume.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
