// Programs of ../commonjs-reentrant-require.ts, one per seed. That file describes them.
import { generate } from "../commonjs-reentrant-require";
import { Random } from "../random";
import { endless } from "../family";

export default endless("commonjs reentrant require", index => ({
  name: `seed ${index + 1}.`,
  // Plain Bun transpiles on one thread here, so files are read in request order. An executable reads no files.
  plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
  make: () => generate(new Random(index + 1)),
}));
