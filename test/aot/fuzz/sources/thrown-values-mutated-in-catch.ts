// Programs of ../thrown-values-mutated-in-catch.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../thrown-values-mutated-in-catch";
import { endless } from "../family";

export default endless("thrown values mutated in catch", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
}));
