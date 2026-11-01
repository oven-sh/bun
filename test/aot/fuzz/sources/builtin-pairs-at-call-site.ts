// A list of programs from ../builtin-pairs-at-call-site.ts, which describes them.
import { programOf, programs } from "../builtin-pairs-at-call-site";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "builtin pairs at call site",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    make: () => ({ file: "main.mjs", text: programOf(index, new Random(index + 1)) }),
  })),
);
