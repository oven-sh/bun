// Programs of ../shadowed-builtin-names.ts, one per seed. That file describes them.
import { generate } from "../shadowed-builtin-names";
import { Random } from "../random";
import { endless } from "../family";

export default endless("shadowed builtin names", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
