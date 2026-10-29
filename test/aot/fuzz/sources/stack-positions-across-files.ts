// Fixed seeds of fuzz/stack-positions-across-files.ts: programs of several files, ES modules, CommonJS and TypeScript, that take functions and classes from
// each other, in which each call in turn throws. They print the function, file, line and column of every frame.
import { Random } from "../random";
import { generate } from "../stack-positions-across-files";
import { family } from "../family";

const plainEnv = {
  // Once plain Bun's optimizing compilers have taken a function into its caller, a stack trace there lists it even if it left by a tail call.
  BUN_JSC_useDFGJIT: "0",
  // The files print while they are loaded. The reference transpiles on one thread: the texts are read in the order in which they are asked for. An
  // executable reads nothing.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
};

export default family(
  "a stack trace has the functions, files, lines and columns that plain Bun shows, whichever call of a program of several files throws",
  [
    ...Array.from({ length: 200 }, (_, index) => ({ seed: index + 1, hasMore: false })),
    ...Array.from({ length: 100 }, (_, index) => ({ seed: index + 1001, hasMore: true })),
    // A class that is defined more than once extends a class of another file.
    ...[483, 1096, 1492, 1730, 1952].map((seed, index) => ({ seed, hasMore: false })),
  ].map(({ seed, hasMore }) => ({
    name: `seed ${seed}.`,
    plainEnv,
    make: () => generate(new Random(seed), hasMore),
  })),
);
