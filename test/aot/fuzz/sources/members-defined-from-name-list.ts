// A fixed list of seeds of ../members-defined-from-name-list.ts, which describes the programs.
import { generate } from "../members-defined-from-name-list";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "members defined from name list",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
