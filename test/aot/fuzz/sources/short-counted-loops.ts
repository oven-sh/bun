// Programs of ../short-counted-loops.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../short-counted-loops";
import { endless } from "../family";

export default endless("short counted loops", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
}));
