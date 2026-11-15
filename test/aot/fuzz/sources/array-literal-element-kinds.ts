// A fixed list of seeds of ../array-literal-element-kinds.ts, which describes the programs.
import { generate } from "../array-literal-element-kinds";
import { Random } from "../random";
import { family } from "../family";

const seeds = Array.from({ length: 60 }, (_, index) => index + 1);

export default family(
  "array literal element kinds",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    make: () => ({
      file: seed % 2 ? "main.ts" : "main.js",
      text: generate(new Random(seed), seed % 2 === 1),
      files: {},
    }),
  })),
);
