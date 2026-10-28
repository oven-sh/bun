// Fixed seeds of fuzz/functions-that-return-before-they-touch-what-the-caller-made.ts: a function takes a rest parameter, or a parameter for which
// its callers write an object or a list, and may return, throw or go on before it touches it. What stands in front of the first use has effects,
// what the caller writes has effects too, and the switch that decides turns while the program runs.
import { generate } from "./fuzz/functions-that-return-before-they-touch-what-the-caller-made";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "functions that return before they touch what the caller made answer as in plain Bun",
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
