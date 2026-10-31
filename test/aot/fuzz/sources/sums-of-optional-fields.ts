// Programs of ../sums-of-optional-fields.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../sums-of-optional-fields";
import { endless } from "../family";

export default endless("sums of optional fields", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
  make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
}));
