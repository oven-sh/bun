// Programs of ../arrays-of-mispredicted-captured-variable.ts, one per seed. That file describes them.
import { generate } from "../arrays-of-mispredicted-captured-variable";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "arrays of mispredicted captured variable",
  index => ({
    name: `seed ${index + 1}.`,
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  }),
);
