// Fixed seeds of fuzz/members-defined-under-names-out-of-a-written-list.ts: a loop over a written list of names defines, stores, reads or
// removes a member under each name, with a step for one of the names that the others lack. What the targets hold afterwards is printed.
import { generate } from "../members-defined-under-names-out-of-a-written-list";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "members defined in a loop over written names are what they are in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
