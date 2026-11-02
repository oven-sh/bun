// Programs of ../builtin-writes-declared-member.ts, one per seed. That file describes them.
import { generate } from "../builtin-writes-declared-member";
import { Random } from "../random";
import { endless } from "../family";

export default endless("builtin writes declared member", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
