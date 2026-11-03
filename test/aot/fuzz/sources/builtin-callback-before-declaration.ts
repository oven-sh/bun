// A fixed list of seeds of ../builtin-callback-before-declaration.ts, which describes the programs.
import { generate } from "../builtin-callback-before-declaration";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "builtin callback before declaration",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
