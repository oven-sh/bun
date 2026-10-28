// Every built-in function, in every way to arrive at a call, with every use of the answer (fuzz/every-built-in-however-it-arrives-whatever-is-done-with-its-answer.ts), twenty to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "./fuzz/every-built-in-however-it-arrives-whatever-is-done-with-its-answer";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "every built-in function however it arrives, whatever is done with its answer",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 2000 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a second look at an answer could tell the compiler what the first may not assume.
    keepsItsText: true as const,
    make: () => ({ file: "main.mjs", text: programOf(index, new Random(index + 1)) }),
  })),
);
