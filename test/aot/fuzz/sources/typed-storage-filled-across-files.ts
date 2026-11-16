// Programs of ../typed-storage-filled-across-files.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../typed-storage-filled-across-files";
import { endless } from "../family";

export default endless("typed storage filled across files", index => {
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1)),
  };
});
