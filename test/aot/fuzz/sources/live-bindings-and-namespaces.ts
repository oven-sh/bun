// Programs of ../live-bindings-and-namespaces.ts, one per seed. That file describes them.
import { generate } from "../live-bindings-and-namespaces";
import { Random } from "../random";
import { endless } from "../family";

export default endless("live bindings and namespaces", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
