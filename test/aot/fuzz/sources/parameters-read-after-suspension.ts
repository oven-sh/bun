// A fixed list of seeds of ../parameters-read-after-suspension.ts, which describes the programs.
import { generate } from "../parameters-read-after-suspension";
import { Random } from "../random";
import { family } from "../family";

export default family("parameters read after suspension", [
  ...Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () =>
      index % 2 === 1
        ? { file: "main.cjs", text: generate(new Random(index + 1), true) }
        : { file: "main.js", text: generate(new Random(index + 1)) },
  })),
]);
