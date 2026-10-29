// Programs of ../ternary-object-or-empty.ts, one per seed. That file describes them.
import { generate } from "../ternary-object-or-empty";
import { Random } from "../random";
import { endless } from "../family";

export default endless("ternary object or empty", index => {
  const isTyped = index % 2 === 0;
  return {
    name: `seed ${index + 1}${isTyped ? ", typed" : ""}.`,
    flags: index % 4 >= 2 ? ["--aot-verify-each-pass", "--aot-check=validate-references"] : [],
    make: () => ({ file: isTyped ? "main.ts" : "main.mjs", text: generate(new Random(index + 1), isTyped) }),
  };
});
