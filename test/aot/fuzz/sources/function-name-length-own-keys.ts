// Programs of ../function-name-length-own-keys.ts, one per seed. That file describes them.
import { generate } from "../function-name-length-own-keys";
import { Random } from "../random";
import { endless } from "../family";

export default endless("function name length own keys", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
