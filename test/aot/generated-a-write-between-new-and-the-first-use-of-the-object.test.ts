// An object is made, something that its making read is written, and only then is the object used (fuzz/a-write-between-new-and-the-first-use-of-the-object.ts), twenty cases to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { flagsOf, programOf, programs } from "./fuzz/a-write-between-new-and-the-first-use-of-the-object";
import { generated } from "./generated/run-generated";

generated(
  "a write between new and the first use of the object",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 250 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a use of the object ahead of the write makes it another program.
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
