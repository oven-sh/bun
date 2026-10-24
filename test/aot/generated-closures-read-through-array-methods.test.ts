// Fixed seeds of fuzz/closures-read-through-array-methods.ts: closures over the variables of one turn of a loop or of an array method are read through array methods that follow one another.
// Each program is also built with every function hot.
import { generate } from "./fuzz/closures-read-through-array-methods";
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
  "a closure sees the variables of the turn it was made in",
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
