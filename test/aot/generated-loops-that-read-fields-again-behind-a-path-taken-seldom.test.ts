// Fixed seeds of fuzz/loops-that-read-fields-again-behind-a-path-taken-seldom.ts: a loop of many turns reads fields, elements, lengths and shared variables several times
// a turn; a path that is taken seldom only computes, or stores to what the loop reads in one of many ways; behind it the loop reads again and adds up what it read.
import { generate } from "./fuzz/loops-that-read-fields-again-behind-a-path-taken-seldom";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated("loops read behind a path that is taken seldom what plain Bun reads", [
  ...Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first 20 seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 20,
    isOnlyCompiled: true as const,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
]);
