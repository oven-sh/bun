// Programs of ../private-names-on-any-object.ts, one per seed. That file describes them.
import { generate } from "../private-names-on-any-object";
import { Random } from "../random";
import { endless } from "../family";

export default endless("private names on any object", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
