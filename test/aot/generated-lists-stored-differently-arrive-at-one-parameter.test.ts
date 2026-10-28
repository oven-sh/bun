// Two lists that are stored in different ways arrive at one parameter (fuzz/lists-stored-differently-arrive-at-one-parameter.ts), twenty cases to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "./fuzz/lists-stored-differently-arrive-at-one-parameter";
import { generated } from "./generated/run-generated";

generated(
  "lists stored differently arrive at one parameter",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 150 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a second look at a list could tell the compiler what the first may not assume.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
