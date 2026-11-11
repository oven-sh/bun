// Programs of ../mistyped-objects-across-files.ts, one per seed. That file describes them.
import { generate } from "../mistyped-objects-across-files";
import { Random } from "../random";
import { endless } from "../family";

export default endless("mistyped objects across files", index => {
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1)),
  };
});
