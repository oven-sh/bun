// Fixed seeds of fuzz/patterns-that-go-back-for-millions-of-turns.ts: regular expressions whose text arrives at run time and that find their match only behind millions of turns of their groups,
// on both sides of the hundred million turns at which plain Bun gives a match up.
import { generate } from "./fuzz/patterns-that-go-back-for-millions-of-turns";
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
  "a pattern made at run time finds every match that plain Bun finds",
  Array.from({ length: 24 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 2,
    isOnlyCompiled: true as const,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
