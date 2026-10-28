// Fixed seeds of fuzz/patterns-with-subjects-made-from-them.ts: regular expressions whose text arrives at run time, most of them in unicode mode, each matched against subjects that are made from it:
// characters of 16 bits, pairs of surrogates and halves of pairs at every place that takes any character, with literals on both sides.
import { generate } from "./fuzz/patterns-with-subjects-made-from-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: [],
  },
});

generated(
  "a pattern made at run time answers as in plain Bun on a subject that is made from it",
  Array.from({ length: 40 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 20,
    isOnlyCompiled: true as const,
    flags: [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
