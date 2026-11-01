// Programs of ../wrong-typings-for-builtins.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../wrong-typings-for-builtins";
import { endless } from "../family";

export default endless("wrong typings for builtins", index => {
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1)),
  };
});
