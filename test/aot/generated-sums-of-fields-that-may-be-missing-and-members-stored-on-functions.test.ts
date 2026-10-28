// Fixed seeds of fuzz/sums-of-fields-that-may-be-missing-and-members-stored-on-functions.ts: loops add up fields of objects that may lack them,
// spelled in many ways, with numbers on both sides of 31 and 32 bits; other loops read and write members stored on functions, which change late
// in the run. One seed in four is a CommonJS file that is not strict.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/sums-of-fields-that-may-be-missing-and-members-stored-on-functions";
import { generated } from "./generated/run-generated";

generated(
  "sums of fields that may be missing are what they are in plain Bun",
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
