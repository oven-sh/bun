// Fixed seeds of fuzz/values-thrown-on-every-road-and-changed-where-they-are-caught.ts: a function keeps a value in a local and throws it
// straight, through calls, callbacks of built-ins, accessors, conversions, proxies, iterators, generators, constructors or rejected promises.
// Where it is caught it is tested, read and changed, and behind the catch the function reads it again through its local.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/values-thrown-on-every-road-and-changed-where-they-are-caught";
import { generated } from "./generated/run-generated";

generated(
  "a value that was thrown, caught and changed reads as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
