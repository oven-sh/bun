// Fixed seeds of fuzz/counters-handed-to-the-one-call-in-a-loop.ts: a loop counts from small numbers to the ends of the 32 and of the 53 bits and hands the counter in each turn to
// the only call of a function, which is small or large and may write to what the loop reads. The folded answers, the number of turns and the counter behind the loop are those of plain Bun.
import { generate } from "./fuzz/counters-handed-to-the-one-call-in-a-loop";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 64 }, (_, index) => index + 1);

generated(
  "a counter that each turn hands to the one call of a function counts as in plain Bun",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 1
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-erase-types"]
          : index % 4 === 3
            ? ["--aot-erase-types", "--aot-heat=everything-is-hot"]
            : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
