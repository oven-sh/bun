// Every pair of built-in functions at one call (fuzz/every-pair-of-built-ins-at-one-call.ts), twenty to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "./fuzz/every-pair-of-built-ins-at-one-call";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "every pair of built-in functions at one call",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 200 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a second look at an answer could tell the compiler what the first may not assume.
    keepsItsText: true as const,
    make: () => ({ file: "main.mjs", text: programOf(index, new Random(index + 1)) }),
  })),
);
