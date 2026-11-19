// Programs of ../mutating-builtin-in-expression.ts, one per seed. That file describes them.
import { generate } from "../mutating-builtin-in-expression";
import { Random } from "../random";
import { endless } from "../family";

export default endless("mutating builtin in expression", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
