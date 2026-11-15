// Programs of ../duplicate-packages.ts, one per seed. That file describes them.
import { corners, generate } from "../duplicate-packages";
import { Random } from "../random";
import { endless } from "../family";

export default endless("duplicate packages", index => {
  const corner = corners[index % corners.length];
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), corner),
  };
});
