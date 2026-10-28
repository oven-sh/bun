// Fixed seeds of fuzz/left-half-way.ts: generators and async generators that are closed, thrown into, dropped or asked again at every place where they can stand.
// Each program is also built as a very large program is, and each executable also runs with a collection at every n-th allocation that leaves the fast path.
import { generate } from "./fuzz/left-half-way";
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
  "a generator may be left at every stop",
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
