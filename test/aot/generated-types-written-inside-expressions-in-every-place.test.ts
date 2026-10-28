// Fixed seeds of fuzz/types-written-inside-expressions-in-every-place.ts: `as`, `as const`, `satisfies`, `!`, `<T>value` and type arguments round targets of assignments, callees, links of
// optional chains, functions that take their names from where they stand, operands, keys and everything else. None of them does anything when the program runs.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/types-written-inside-expressions-in-every-place";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});

generated(
  "types written inside expressions in every place",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
