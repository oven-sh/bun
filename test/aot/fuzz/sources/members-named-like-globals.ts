// Programs of ../members-named-like-globals.ts, one per seed. That file describes them.
import { generate } from "../members-named-like-globals";
import { Random } from "../random";
import { endless } from "../family";

export default endless("members named like globals", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
