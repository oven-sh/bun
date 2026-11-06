// Every built-in function, in every way to arrive at a call, with every use of the answer (fuzz/every-built-in-however-it-arrives-whatever-is-done-with-its-answer.ts), twenty to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import { programOf, programs } from "../every-built-in-however-it-arrives-whatever-is-done-with-its-answer";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "every built-in function however it arrives, whatever is done with its answer",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    make: () => ({ file: "main.mjs", text: programOf(index, new Random(index + 1)) }),
  })),
);
