// Programs of ../same-keys-different-value-types.ts, one per seed. That file describes them.
import { generate } from "../same-keys-different-value-types";
import { Random } from "../random";
import { endless } from "../family";

export default endless("same keys different value types", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
