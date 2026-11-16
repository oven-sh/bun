// Programs of ../polymorphic-delete-sites.ts, one per seed. That file describes them.
import { generate } from "../polymorphic-delete-sites";
import { Random } from "../random";
import { endless } from "../family";

export default endless("polymorphic delete sites", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
}));
