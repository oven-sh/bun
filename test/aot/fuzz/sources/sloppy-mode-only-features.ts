// Programs of ../sloppy-mode-only-features.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../sloppy-mode-only-features";
import { endless } from "../family";

export default endless("sloppy mode only features", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.cjs", text: generate(new Random(index + 1)) }),
}));
