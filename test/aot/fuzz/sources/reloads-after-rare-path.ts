// A fixed list of seeds of ../reloads-after-rare-path.ts, which describes the programs.
import { generate } from "../reloads-after-rare-path";
import { Random } from "../random";
import { family } from "../family";

export default family("reloads after rare path", [
  ...Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
]);
