// Programs of ../side-effects-in-unused-expressions.ts, one per seed. That file describes them.
import { generate } from "../side-effects-in-unused-expressions";
import { Random } from "../random";
import { endless } from "../family";

export default endless("side effects in unused expressions", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
