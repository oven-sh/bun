// Fixed seeds of fuzz/values-that-hold-themselves-written-as-json.ts: JSON.stringify is given records and lists that hold themselves, hold one object twice, or hold neither,
// with members around them that run the program's own code. Each call prints its answer or its error, how often that code ran, and in which order.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/values-that-hold-themselves-written-as-json";
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
  "a value that holds itself is refused before any of its members is written again",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", every function hot." : "."}`,
    isAlwaysRun: index % 6 < 2,
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
