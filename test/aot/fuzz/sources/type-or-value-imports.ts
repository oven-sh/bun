// Programs of ../type-or-value-imports.ts, one per seed. That file describes them.
import { generate, options } from "../type-or-value-imports";
import { Random } from "../random";
import { endless } from "../family";

export default endless("type or value imports", index => ({
  name: `seed ${index + 1}, ${options[index % options.length]}.`,
  make: () => ({ file: "main.ts", ...generate(new Random(index + 1), options[index % options.length]) }),
}));
