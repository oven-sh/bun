// Programs of ../stack-frames-of-array-constructor.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../stack-frames-of-array-constructor";
import { endless } from "../family";

// Every run includes these.
export default endless(
  "stack frames of array constructor",
  index => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 4 === 1 ? ["--aot-heat=everything-is-cold"] : index % 4 === 2 ? ["--aot-heat=everything-is-hot"] : [],
    make: () =>
      index % 4 === 3
        ? { file: "main.ts", text: generate(new Random(index + 1), true) }
        : { file: "main.mjs", text: generate(new Random(index + 1)) },
  }),
);
