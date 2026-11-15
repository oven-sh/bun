// A fixed list of seeds of ../descriptor-copies-then-mutated.ts, which describes the programs.
import { generate } from "../descriptor-copies-then-mutated";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "descriptor copies then mutated",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
