// Fixed seeds of fuzz/names-asked-of-full-tables-and-texts-converted-again.ts: objects that keep a table of their names are asked for names that are there, never were or were deleted, while the
// table grows and shrinks; and the lower and upper case forms of hundreds of lasting texts are asked for again and again, with texts replaced and collections between.
import { generate } from "./fuzz/names-asked-of-full-tables-and-texts-converted-again";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 48 }, (_, index) => index + 1);

generated(
  "names asked of full tables and texts converted again answer as in plain Bun",
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
