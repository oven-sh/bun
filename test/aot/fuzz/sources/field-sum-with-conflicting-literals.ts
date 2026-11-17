// Programs of ../field-sum-with-conflicting-literals.ts, one per seed. That file describes them.
import { generate } from "../field-sum-with-conflicting-literals";
import { Random } from "../random";
import { endless } from "../family";

export default endless("field sum with conflicting literals", index => ({
  name: `seed ${index + 1}.`,
  flags: ["--aot-erase-types"],
  make: () => generate(new Random(index + 1)),
}));
