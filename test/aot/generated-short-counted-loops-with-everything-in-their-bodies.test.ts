// Fixed seeds of fuzz/short-counted-loops-with-everything-in-their-bodies.ts: functions that are called very often hold a loop with a constant
// start, step and bound that takes zero to nine turns. The body breaks, continues, returns, throws, catches, writes the counter and makes
// closures over it. One seed in four is a CommonJS file that is not strict.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/short-counted-loops-with-everything-in-their-bodies";
import { generated } from "./generated/run-generated";

generated(
  "short counted loops compute what they compute in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
