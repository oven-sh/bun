// A fixed list of seeds of ../dynamic-import-settle-order.ts, which describes the programs.
import { Random } from "../random";
import { forms, generate } from "../dynamic-import-settle-order";
import { family } from "../family";

export default family(
  "dynamic import settle order",
  Array.from({ length: 120 }, (_, index) => index + 1)
    // Seeds 87 and 90 call `import()` for a module that a load in progress has already requested. The tick in which
    // such a load finishes is unspecified, and plain Bun's order depends on its thread count and on the machine's load.
    .filter(seed => seed !== 87 && seed !== 90)
    .flatMap(seed =>
      forms.map(form => ({
        name: `seed ${seed}, ${form}.`,
        // Plain Bun transpiles on one thread here, so files are read in request order. Without the variable it reads
        // them on several threads and a file that `import()` asks for runs in a later turn, as it does in an
        // executable.
        plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
        unstablePlainOutput: "as plain Bun where it reads files on several threads",
        make: () => generate(new Random(seed), form),
      })),
    ),
);
