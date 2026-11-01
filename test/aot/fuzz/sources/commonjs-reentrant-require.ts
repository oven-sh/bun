// Programs of ../commonjs-reentrant-require.ts, one per seed. That file describes them.
import { generate } from "../commonjs-reentrant-require";
import { Random } from "../random";
import { endless } from "../family";

export default endless("commonjs reentrant require", index => ({
  name: `seed ${index + 1}.`,
  // Plain Bun transpiles on one thread here, so files are read in request order. Without the variable it reads them on
  // several threads and a file that `import()` asks for runs in a later turn, as it does in an executable.
  plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
  unstablePlainOutput: "as plain Bun where it reads files on several threads",
  make: () => generate(new Random(index + 1)),
}));
