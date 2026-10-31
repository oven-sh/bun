// Programs of ../import-equals-namespace-members.ts, one per seed. That file describes them.
import { generate } from "../import-equals-namespace-members";
import { Random } from "../random";
import { endless } from "../family";

export default endless("import equals namespace members", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
