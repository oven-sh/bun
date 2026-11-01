// Programs of ../literals-allocate-fresh-objects.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../literals-allocate-fresh-objects";
import { endless } from "../family";

export default endless("literals allocate fresh objects", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
