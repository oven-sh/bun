// Fixed seeds of fuzz/turns-in-which-imports-settle.ts: small graphs of ES modules whose bodies and jobs call `import()`, beside a chain of jobs that prints its turns. Each seed comes in six forms:
// its first file is the entry point, a further entry point that is imported under a computed name, imported under its name, required, or either of the second and the third beside a chain of the file that
// starts it.
import { Random } from "./fuzz/random";
import { forms, generate } from "./fuzz/turns-in-which-imports-settle";
import { generated } from "./generated/run-generated";

generated(
  "turns in which imports settle",
  Array.from({ length: 120 }, (_, index) =>
    forms.map(form => ({
      name: `seed ${index + 1}, ${form}.`,
      // Every run takes the first eight seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 8,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more job would change the turns.
      keepsItsText: true as const,
      // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
      plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
      make: () => generate(new Random(index + 1), form),
    })),
  ).flat(),
);
