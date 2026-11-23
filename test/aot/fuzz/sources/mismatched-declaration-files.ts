// Programs of ../mismatched-declaration-files.ts, one per seed. That file describes them.
import { generate, said } from "../mismatched-declaration-files";
import { Random } from "../random";
import { endless } from "../family";

export default endless("mismatched declaration files", index => {
  const what = said[index % said.length];
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}, ${what}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), what),
  };
});
