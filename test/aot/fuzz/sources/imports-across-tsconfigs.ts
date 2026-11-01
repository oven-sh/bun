// Programs of ../imports-across-tsconfigs.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../imports-across-tsconfigs";
import { endless } from "../family";

export default endless("imports across tsconfigs", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
