// Fixed seeds of fuzz/stack-positions-in-ordinary-code.ts: programs of ordinary code over several lines, in which each call in turn throws. They print the
// function, line and column of every frame.
import { Random } from "../../fuzz/random";
import { generate } from "../../fuzz/stack-positions-in-ordinary-code";
import { generated } from "../../generated/run-generated";

// Once plain Bun's optimizing compilers have taken a function into its caller, a stack trace there lists it even if it left by a tail call.
const plainEnv = { BUN_JSC_useDFGJIT: "0" };

const seeds = (first: number, count: number) => Array.from({ length: count }, (_, index) => first + index);
const isTyped = (seed: number) => seed % 2 === 0;
const cases = [
  // Every run takes the first seeds of each kind; AOT_GENERATED=all takes all.
  ...seeds(1, 200).map((seed, index) => ({ seed, isAlwaysRun: index < 12, isCommonJs: false, isBroad: false })),
  ...seeds(201, 100).map((seed, index) => ({ seed, isAlwaysRun: index < 4, isCommonJs: true, isBroad: false })),
  ...seeds(5101, 100).map((seed, index) => ({ seed, isAlwaysRun: index < 4, isCommonJs: false, isBroad: true })),
  ...seeds(5301, 100).map((seed, index) => ({ seed, isAlwaysRun: index < 2, isCommonJs: true, isBroad: true })),
];

generated(
  "a stack trace has the functions, lines and columns that plain Bun shows, whichever call of a program throws",
  cases.map(({ seed, isAlwaysRun, isCommonJs, isBroad }) => ({
    name: `seed ${seed}.`,
    isAlwaysRun,
    isOnlyCompiled: true as const,
    plainEnv,
    make: () => ({
      file: isCommonJs ? "main.cjs" : isTyped(seed) ? "main.ts" : "main.js",
      text: generate(new Random(seed), !isCommonJs && isTyped(seed), false, isCommonJs, isBroad),
    }),
  })),
);
