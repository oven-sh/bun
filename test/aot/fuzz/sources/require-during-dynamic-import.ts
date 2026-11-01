// Programs of ../require-during-dynamic-import.ts, one per seed. That file describes them.
import { endless } from "../family";
import { generate } from "../require-during-dynamic-import";
import { Random } from "../random";

export default endless("require during dynamic import", index => ({
  name: `seed ${index + 1}, a module awaits.`,
  // Plain Bun transpiles on one thread here, so files are read in request order. An executable reads no files.
  plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
  make: () => generate(new Random(index + 1), { awaits: true }),
}));
