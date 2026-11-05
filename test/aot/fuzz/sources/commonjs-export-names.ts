// A fixed list of seeds of ../commonjs-export-names.ts, which describes the programs.
import { generate } from "../commonjs-export-names";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "commonjs export names",
  Array.from({ length: 840 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1), index >= 480),
  })),
);
