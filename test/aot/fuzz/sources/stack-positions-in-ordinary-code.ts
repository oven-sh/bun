// A fixed list of seeds of ../stack-positions-in-ordinary-code.ts, which describes the programs.
import { Random } from "../random";
import { generate } from "../stack-positions-in-ordinary-code";
import { family } from "../family";

// Once plain Bun's optimizing JIT has inlined a function, a stack trace lists it even if it left by a tail call.
const plainEnv = { BUN_JSC_useDFGJIT: "0" };

const seeds = (first: number, count: number) => Array.from({ length: count }, (_, index) => first + index);
const isTyped = (seed: number) => seed % 2 === 0;
const cases = [
  ...seeds(1, 200).map((seed, index) => ({ seed, isCommonJs: false, isBroad: false })),
  ...seeds(201, 100).map((seed, index) => ({ seed, isCommonJs: true, isBroad: false })),
  ...seeds(5101, 100).map((seed, index) => ({ seed, isCommonJs: false, isBroad: true })),
  ...seeds(5301, 100).map((seed, index) => ({ seed, isCommonJs: true, isBroad: true })),
];

export default family(
  "stack positions in ordinary code",
  cases.map(({ seed, isCommonJs, isBroad }) => ({
    name: `seed ${seed}.`,
    plainEnv,
    make: () => ({
      file: isCommonJs ? "main.cjs" : isTyped(seed) ? "main.ts" : "main.js",
      text: generate(new Random(seed), !isCommonJs && isTyped(seed), false, isCommonJs, isBroad),
    }),
  })),
);
