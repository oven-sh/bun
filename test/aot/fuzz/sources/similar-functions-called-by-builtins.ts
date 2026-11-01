// Programs of ../similar-functions-called-by-builtins.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../similar-functions-called-by-builtins";
import { endless } from "../family";

export default endless("similar functions called by builtins", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
