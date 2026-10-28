// Fixed seeds of fuzz/strangers-where-a-type-names-a-class.ts: a hot loop reads a member of a field whose type names a class. Instances of the class arrive there, and then records with a field
// of that name, classes below and beside it, objects without a prototype, proxies and null, by stores under unknown keys and by casts. Each walk answers as in plain Bun.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/strangers-where-a-type-names-a-class";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 64 }, (_, index) => index + 1);

generated(
  "a member read where the type names a class answers for whatever arrives",
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
