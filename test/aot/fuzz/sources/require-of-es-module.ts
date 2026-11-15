// Programs of ../require-of-es-module.ts, one per seed. That file describes them.
import { Random } from "../random";
import { corners, generate } from "../require-of-es-module";
import { endless } from "../family";

export default endless("require of es module", index => {
  const corner = corners[index % corners.length];
  return {
    name: `seed ${index + 1}, ${corner}.`,
    make: () => generate(new Random(index + 1), corner),
  };
});
