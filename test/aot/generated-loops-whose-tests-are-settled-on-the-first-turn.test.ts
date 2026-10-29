// Fixed seeds of fuzz/loops-whose-tests-are-settled-on-the-first-turn.ts: a counter starts at a written number, a test of it is settled on the first turn by arithmetic alone, and behind the test stands a read
// that something in the loop may store to. The loop runs no turn, one, a few, a thousand, over what is declared and over what is not.
import { generate } from "./fuzz/loops-whose-tests-are-settled-on-the-first-turn";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 48 }, (_, index) => index + 1);

generated(
  "a loop whose test is settled on the first turn reads what plain Bun reads in every turn",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 12,
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
