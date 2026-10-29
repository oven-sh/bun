// Fixed seeds of fuzz/bind-spread-flatmap-and-boolean-arithmetic.ts: `this.method = this.method.bind(this)`, spreads, flatMap,
// arithmetic on booleans and getters defined under computed keys, each run many times at one place in the code, with something
// unusual arriving in the middle of the run. Every second seed is TypeScript.
import { generate } from "./fuzz/bind-spread-flatmap-and-boolean-arithmetic";
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
  "an everyday idiom keeps working when something unusual arrives at the same place",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
