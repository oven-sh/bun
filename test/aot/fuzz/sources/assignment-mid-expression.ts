// A fixed list of seeds of ../assignment-mid-expression.ts, which describes the programs.
import { generate } from "../assignment-mid-expression";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "assignment mid expression",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
