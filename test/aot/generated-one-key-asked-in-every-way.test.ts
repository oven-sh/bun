// Fixed seeds of fuzz/one-key-asked-in-every-way.ts: one key is asked of one value by a read, `in`, Object.hasOwn, stores, a delete, a call and patterns, one behind the other, for many turns.
// Odd seeds are TypeScript. Each program is also built with every function hot.
import { generate } from "./fuzz/one-key-asked-in-every-way";
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
  "each way to ask for a key answers for itself",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", every function hot." : "."}`,
    // Every run takes the first twenty seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 40,
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: (index >> 1) & 1 ? "main.js" : "main.ts",
      text: generate(new Random((index >> 1) + 1), !((index >> 1) & 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
