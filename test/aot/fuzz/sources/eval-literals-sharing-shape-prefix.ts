// Programs of ../eval-literals-sharing-shape-prefix.ts, one per seed. That file describes them.
import { generate } from "../eval-literals-sharing-shape-prefix";
import { Random } from "../random";
import { endless } from "../family";

export default endless("eval literals sharing shape prefix", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: index & 1 ? "main.js" : "main.ts", text: generate(new Random(index + 1), !(index & 1)) }),
}));
