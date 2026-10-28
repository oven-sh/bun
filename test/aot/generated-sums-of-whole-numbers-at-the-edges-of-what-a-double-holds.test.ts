// Fixed seeds of fuzz/sums-of-whole-numbers-at-the-edges-of-what-a-double-holds.ts: loops add and subtract whole numbers at the edges of 31, 32, 52
// and 53 bits and cut the sum to 32 bits, to a whole number, or not at all. Now and then a field holds what is no whole number.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/sums-of-whole-numbers-at-the-edges-of-what-a-double-holds";
import { generated } from "./generated/run-generated";

generated(
  "sums of whole numbers at the edges of what a double holds are plain Bun's",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
