// A list of programs from ../write-between-new-and-use.ts, which describes them.
import { flagsOf, programOf, programs } from "../write-between-new-and-use";
import { family } from "../family";

export default family(
  "write between new and use",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
