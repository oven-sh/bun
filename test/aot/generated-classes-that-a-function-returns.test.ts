// A function returns a class expression (fuzz/classes-that-a-function-returns.ts), twenty cases to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "./fuzz/classes-that-a-function-returns";
import { generated } from "./generated/run-generated";

generated(
  "classes that a function returns",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 40 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a second look at a class could tell the compiler what the first may not assume.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
