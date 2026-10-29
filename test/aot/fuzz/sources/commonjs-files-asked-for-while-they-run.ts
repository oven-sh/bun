// fuzz/commonjs-files-asked-for-while-they-run.ts: a CommonJS file is asked for again while it runs, by itself or by what it requires, and then throws or ends.
import { generate } from "../commonjs-files-asked-for-while-they-run";
import { Random } from "../random";
import { endless } from "../family";

export default endless("CommonJS files asked for while they run", index => ({
  name: `seed ${index + 1}.`,
  // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
  plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
  make: () => generate(new Random(index + 1)),
}));
