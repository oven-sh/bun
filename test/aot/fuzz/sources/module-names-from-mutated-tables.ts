// Programs of ../module-names-from-mutated-tables.ts, one per seed. That file describes them.
import { generate } from "../module-names-from-mutated-tables";
import { Random } from "../random";
import { endless } from "../family";

export default endless("module names from mutated tables", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
