// Fixed seeds of fuzz/makers-of-makers-each-with-a-prototype-of-its-own.ts: one function makes a prototype object and a maker of objects below it, and the program calls it one to forty times.
// Each call has a prototype, a maker, methods and counters of its own; a change to one prototype is seen below that one alone.
import { generate } from "./fuzz/makers-of-makers-each-with-a-prototype-of-its-own";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 60 }, (_, index) => index + 1);

generated(
  "each call of a function that makes a prototype and a maker has a prototype of its own",
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
