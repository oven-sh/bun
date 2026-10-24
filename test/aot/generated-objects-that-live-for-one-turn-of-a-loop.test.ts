// Fixed seeds of fuzz/objects-that-live-for-one-turn-of-a-loop.ts: objects, lists, instances, closures and the variables that closures share are made anew in each turn of a loop and used inside the function that makes them.
// Each program is also built with every function hot.
import { generate } from "./fuzz/objects-that-live-for-one-turn-of-a-loop";
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
    types: [],
  },
});

generated(
  "each turn of a loop has its own objects",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", every function hot." : "."}`,
    // Every run takes the first twenty seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 40,
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
