// Programs of ../tagged-template-strings-identity.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../tagged-template-strings-identity";
import { endless } from "../family";

export default endless("tagged template strings identity", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
