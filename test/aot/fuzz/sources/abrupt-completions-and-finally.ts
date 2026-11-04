// Programs of ../abrupt-completions-and-finally.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate, kinds } from "../abrupt-completions-and-finally";
import { endless } from "../family";

export default endless("abrupt completions and finally", index => ({
  name: `seed ${index + 1}, ${kinds[index % kinds.length]}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1), kinds[index % kinds.length]) }),
}));
