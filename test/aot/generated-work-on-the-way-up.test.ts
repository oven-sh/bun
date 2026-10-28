// Fixed seeds of fuzz/work-on-the-way-up.ts: recursion of every kind to the end of the stack, caught at every depth on the way up, with calls into the library and allocation in each catch and finally.
// Each program is also built as a very large program is, and each executable also runs with a collection at every n-th allocation that leaves the fast path.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/work-on-the-way-up";
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
  "work in every catch and finally on the way up from the end of the stack",
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
