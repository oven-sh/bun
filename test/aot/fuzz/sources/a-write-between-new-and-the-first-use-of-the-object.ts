// An object is made, something that its making read is written, and only then is the object used (fuzz/a-write-between-new-and-the-first-use-of-the-object.ts), twenty cases to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { flagsOf, programOf, programs } from "../a-write-between-new-and-the-first-use-of-the-object";
import { family } from "../family";

export default family(
  "a write between new and the first use of the object",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
