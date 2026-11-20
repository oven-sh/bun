// Programs of ../commonjs-export-forms.ts, one per seed. That file describes them.
import { generate } from "../commonjs-export-forms";
import { endless } from "../family";
import { Random } from "../random";

export default endless("commonjs export forms", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
