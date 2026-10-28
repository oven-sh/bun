// Fixed seeds of fuzz/turns-in-which-imports-settle.ts: small graphs of ES modules whose bodies and jobs call `import()`, beside a chain of jobs that prints its turns. Each seed comes in six forms:
// its first file is the entry point, a further entry point that is imported under a computed name, imported under its name, required, or either of the second and the third beside a chain of the file that
// starts it.
import { Random } from "../random";
import { forms, generate } from "../turns-in-which-imports-settle";
import { family } from "../family";

export default family(
  "turns in which imports settle",
  Array.from({ length: 120 }, (_, index) => index + 1)
    // Seed 90 calls `import()` for a module that a load in flight has asked for. The language leaves open in which turn such a load ends, and plain Bun prints one order on one thread and others on several.
    .filter(seed => seed !== 90)
    .flatMap(seed =>
      forms.map(form => ({
        name: `seed ${seed}, ${form}.`,
        // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
        plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
        make: () => generate(new Random(seed), form),
      })),
    ),
);
