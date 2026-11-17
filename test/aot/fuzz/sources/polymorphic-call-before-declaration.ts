// Programs of ../polymorphic-call-before-declaration.ts, one per seed. That file describes them.
import { generate } from "../polymorphic-call-before-declaration";
import { Random } from "../random";
import { endless } from "../family";

export default endless("polymorphic call before declaration", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
