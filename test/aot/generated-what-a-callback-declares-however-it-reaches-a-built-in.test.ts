// Fixed seeds of fuzz/what-a-callback-declares-however-it-reaches-a-built-in.ts: a built-in runs a callback once for each element; the callback came to it as an argument of a method call or through call, apply,
// Reflect.apply, bind or a function that hands it on. The variables, closures, functions, classes and objects that the callback declares are made anew in each run.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-a-callback-declares-however-it-reaches-a-built-in";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 48 }, (_, index) => index + 1);

generated(
  "what a callback declares is made anew in each run, however the callback reached the built-in",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 3 === 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.js",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
