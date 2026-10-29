// Every pair of built-in functions at one call (fuzz/every-pair-of-built-ins-at-one-call.ts), twenty to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "../every-pair-of-built-ins-at-one-call";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "every pair of built-in functions at one call",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    make: () => ({ file: "main.mjs", text: programOf(index, new Random(index + 1)) }),
  })),
);
