// Programs of ../unusual-descriptors-on-exports.ts, one per seed. That file describes them.
import { generate } from "../unusual-descriptors-on-exports";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "unusual descriptors on exports",
  index => ({
    name: `seed ${index + 1}.`,
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  }),
);
