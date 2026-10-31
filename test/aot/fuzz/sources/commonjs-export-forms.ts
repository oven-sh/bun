// Programs of ../commonjs-export-forms.ts, one per seed. That file describes them.
import { generate } from "../commonjs-export-forms";
import { endless } from "../family";
import { Random } from "../random";

export default endless("commonjs export forms", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
  make: () => generate(new Random(index + 1)),
}));
