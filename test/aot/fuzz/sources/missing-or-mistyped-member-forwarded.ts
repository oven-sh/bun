// Programs of ../missing-or-mistyped-member-forwarded.ts, one per seed. That file describes them.
import { generate } from "../missing-or-mistyped-member-forwarded";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "missing or mistyped member forwarded",
  index => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  }),
);
