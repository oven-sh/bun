// Programs of ../sloppy-mode-this.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../sloppy-mode-this";
import { endless } from "../family";

export default endless("sloppy mode this", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.cjs", text: generate(new Random(index + 1), index % 4 === 3) }),
}));
