// Fixed seeds of fuzz/changed-while-it-is-walked.ts: a loop or a built-in walks an array, a Map, a Set or an object, and at one step the program changes the very thing that is walked.
// Each program is also built as a very large program is, and each executable also runs with a collection at every n-th allocation that leaves the fast path.
import { generate } from "./fuzz/changed-while-it-is-walked";
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
  "what is walked may change at every step",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", as a very large program." : "."}`,
    isAlwaysRun: index % 6 < 2,
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"] : [],
    alsoUnder: [{ BUN_JSC_slowPathAllocsBetweenGCs: "23" }],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
