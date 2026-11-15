// A fixed list of seeds of ../stack-frames-of-return-variable.ts, which describes the programs.
import { Random } from "../random";
import { generate } from "../stack-frames-of-return-variable";
import { family } from "../family";

export default family(
  "stack frames of return variable",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () =>
      index % 4 === 3
        ? { file: "main.ts", text: generate(new Random(index + 1), true) }
        : { file: "main.js", text: generate(new Random(index + 1)) },
  })),
);
