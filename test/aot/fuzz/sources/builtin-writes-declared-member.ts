// Programs of ../builtin-writes-declared-member.ts, one per seed. That file describes them.
import { generate } from "../builtin-writes-declared-member";
import { Random } from "../random";
import { endless } from "../family";

export default endless("builtin writes declared member", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
