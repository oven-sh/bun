// Fixed seeds of fuzz/lists-of-numbers-through-one-map-or-filter.ts: a list of numbers goes through one map, filter, flatMap or Array.from in code that runs often; after some turns another kind of list comes,
// the callback gives a fraction, -0, NaN or nothing where it gave whole numbers, or changes the list under the traversal; the list that comes out is read in every way.
import { generate } from "./fuzz/lists-of-numbers-through-one-map-or-filter";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 48 }, (_, index) => index + 1);

generated(
  "a list of numbers that went through one map or filter holds what it holds in plain Bun",
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
