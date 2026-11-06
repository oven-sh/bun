// fuzz/long-histories-of-objects-beside-declared-types-seen-with-their-attributes.ts: a few slots hold literals typed by an
// interface, instances and literals without a type; a history of thousands of drawn steps stores, removes, defines with attributes, freezes and
// copies them in every way. The program sums up every own key in its order with its value and its attributes.
import { generate } from "../long-histories-of-objects-beside-declared-types-seen-with-their-attributes";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "objects keep their values, attributes and key order through a long history as in plain Bun",
  index => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  }),
);
