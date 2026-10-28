// Fixed seeds of fuzz/list-literals-of-every-kind-of-element-returned-through-functions-and-read.ts: list literals of whole numbers, fractions, -0, NaN, holes, texts or nothing go through one or two
// functions, which are handed other lists, among them an empty one that is seen under two element types, and their elements are read and computed with. Odd seeds are typed.
import { generate } from "./fuzz/list-literals-of-every-kind-of-element-returned-through-functions-and-read";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 60 }, (_, index) => index + 1);

generated(
  "an element of a list literal that went through functions reads as in plain Bun",
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
