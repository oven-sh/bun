// Fixed seeds of fuzz/arrays-grown-from-empty-literals.ts: arrays that start as `[]` and grow by a schedule that changes from call to
// call hold what they hold in plain Bun. Every second seed is TypeScript.
import { generate } from "./fuzz/arrays-grown-from-empty-literals";
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
  "arrays grown from empty literals hold the same elements as in plain Bun",
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
