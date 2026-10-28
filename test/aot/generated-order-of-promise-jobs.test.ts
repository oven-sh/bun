// Fixed seeds of fuzz/order-of-promise-jobs.ts: handlers of then, catch and finally on promises of every state, awaits, microtasks and
// ticks, some under a store of AsyncLocalStorage, run in the order in which plain Bun runs them. Every second seed is TypeScript.
import { generate } from "./fuzz/order-of-promise-jobs";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: ["bun-types"],
  },
});

generated(
  "promise jobs run in the same order as in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
