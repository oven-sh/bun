// A fixed list of seeds of ../stack-positions-across-files.ts, which describes the programs.
import { Random } from "../random";
import { generate } from "../stack-positions-across-files";
import { family } from "../family";

const plainEnv = {
  // Once plain Bun's optimizing JIT has inlined a function, a stack trace lists it even if it left by a tail call.
  BUN_JSC_useDFGJIT: "0",
  // The files print while they load. Plain Bun transpiles on one thread here, so files are read in request order. An
  // executable reads no files.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
};

export default family(
  "stack positions across files",
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
