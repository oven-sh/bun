// Fixed seeds of fuzz/constructors-run-for-another-new-target-and-what-they-make-is-read.ts: functions, classes, classes below built-in classes, bound functions and proxies are constructed for a
// new target of another kind, and what they make is asked for its length, elements, size, fields, keys, prototype and text. Odd seeds are typed.
import { generate } from "./fuzz/constructors-run-for-another-new-target-and-what-they-make-is-read";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 60 }, (_, index) => index + 1);

generated(
  "what a constructor makes for another new target answers as in plain Bun",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    make: () => ({
      file: seed % 2 ? "main.ts" : "main.js",
      text: generate(new Random(seed), seed % 2 === 1),
      files: {},
    }),
  })),
);
