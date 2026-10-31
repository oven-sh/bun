// Programs of ../top-level-values-inputs-mutated.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../top-level-values-inputs-mutated";
import { endless } from "../family";

export default endless("top level values inputs mutated", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 3 ? ["--aot-validate"] : [],
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
