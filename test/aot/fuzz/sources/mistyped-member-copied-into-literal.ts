// Programs of ../mistyped-member-copied-into-literal.ts, one per seed. That file describes them.
import { generate } from "../mistyped-member-copied-into-literal";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "mistyped member copied into literal",
  index => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  }),
);
