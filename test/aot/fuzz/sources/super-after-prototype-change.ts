// Programs of ../super-after-prototype-change.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../super-after-prototype-change";
import { endless } from "../family";

export default endless("super after prototype change", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
