// fuzz/modules-required-while-imports-load-them.ts: several `import()` calls, started in different jobs, load graphs of ES modules that share files, and `require()` asks for one of
// those files meanwhile. A shared module awaits: where none does, require() returns the module in every turn, which plain Bun does not (docs/compiler/compatibility.mdx).
import { endless } from "../family";
import { generate } from "../modules-required-while-imports-load-them";
import { Random } from "../random";

export default endless("modules required while imports load them", index => ({
  name: `seed ${index + 1}, a module awaits.`,
  // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
  plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
  make: () => generate(new Random(index + 1), { awaits: true }),
}));
