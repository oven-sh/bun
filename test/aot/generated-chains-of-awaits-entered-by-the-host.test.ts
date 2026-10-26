// Fixed seeds of fuzz/chains-of-awaits-entered-by-the-host.ts: chains of async functions that mostly wait for nothing, entered from timers, ticks, microtasks, events, messages, servers
// and module bodies, write down their steps in the order in which plain Bun runs them. Every second seed is TypeScript; two seeds of four load modules that await while the chains run.
import { generate, generateWithModules } from "./fuzz/chains-of-awaits-entered-by-the-host";
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
  "chains of awaits run in the same order as in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => {
      const seed = index + 1;
      const typed = seed % 2 === 1;
      const { text, files } =
        (seed >> 1) % 2 === 0
          ? generateWithModules(new Random(seed), typed)
          : { text: generate(new Random(seed), typed), files: {} };
      return { file: typed ? "main.ts" : "main.mjs", text, files: { ...files, "tsconfig.json": tsconfig } };
    },
  })),
);
