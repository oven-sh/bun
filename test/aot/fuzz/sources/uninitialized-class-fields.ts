// Programs of ../uninitialized-class-fields.ts, one per seed. That file describes them.
import { generate, options } from "../uninitialized-class-fields";
import { Random } from "../random";
import { endless } from "../family";

export default endless("uninitialized class fields", index => {
  // Programs share an executable with those that have the same tsconfig.json, so the options come in runs of four.
  const option = options[Math.floor(index / 4) % options.length];
  return {
    name: `seed ${index + 1}, ${option}.`,
    make: () => ({ file: "main.ts", ...generate(new Random(index + 1), option) }),
  };
});
