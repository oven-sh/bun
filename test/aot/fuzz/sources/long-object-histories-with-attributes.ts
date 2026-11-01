// Programs of ../long-object-histories-with-attributes.ts, one per seed. That file describes them.
import { generate } from "../long-object-histories-with-attributes";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "long object histories with attributes",
  index => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  }),
);
