// A list of programs from ../builtin-call-forms-and-uses.ts, which describes them.
import { programOf, programs } from "../builtin-call-forms-and-uses";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "builtin call forms and uses",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    make: () => ({ file: "main.mjs", text: programOf(index, new Random(index + 1)) }),
  })),
);
