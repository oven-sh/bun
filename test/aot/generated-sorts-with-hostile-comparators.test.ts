// Fixed seeds of fuzz/sorts-with-hostile-comparators.ts: `sort` and `toSorted` with a comparator that answers at random, NaN, one thing
// always or no number at all, and that at one call throws, changes the array, its length or its kind of storage, or sorts it again.
// Every second seed is TypeScript.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/sorts-with-hostile-comparators";
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
  "sort() and toSorted() answer as plain Bun does whatever the comparator does",
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
