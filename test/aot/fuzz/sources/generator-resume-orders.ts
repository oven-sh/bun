// A fixed list of seeds of ../generator-resume-orders.ts, which describes the programs.
import { generate } from "../generator-resume-orders";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "generator resume orders",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
