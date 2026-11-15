// Programs of ../require-during-dynamic-import.ts, one per seed. That file describes them.
import { endless } from "../family";
import { generate } from "../require-during-dynamic-import";
import { Random } from "../random";

export default endless("require during dynamic import", index => ({
  name: `seed ${index + 1}, a module awaits.`,
  // Plain Bun transpiles on one thread here, so files are read in request order. Without the variable it reads them on
  // several threads and a file that `import()` asks for runs in a later turn, as it does in an executable.
  plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
  unstablePlainOutput: "as plain Bun where it reads files on several threads",
  make: () => generate(new Random(index + 1), { awaits: true }),
}));
