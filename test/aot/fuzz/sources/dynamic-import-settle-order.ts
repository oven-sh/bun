// A fixed list of seeds of ../dynamic-import-settle-order.ts, which describes the programs.
import { Random } from "../random";
import { forms, generate } from "../dynamic-import-settle-order";
import { family } from "../family";

export default family(
  "dynamic import settle order",
  Array.from({ length: 120 }, (_, index) => index + 1)
    // Seed 90 calls `import()` for a module that a load in progress has already requested. The tick in which such a
    // load finishes is unspecified, and plain Bun's order depends on its thread count.
    .filter(seed => seed !== 90)
    .flatMap(seed =>
      forms.map(form => ({
        name: `seed ${seed}, ${form}.`,
        // Plain Bun transpiles on one thread here, so files are read in request order. An executable reads no files.
        plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
        make: () => generate(new Random(seed), form),
      })),
    ),
);
