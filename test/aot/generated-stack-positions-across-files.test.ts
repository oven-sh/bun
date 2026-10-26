// Fixed seeds of fuzz/stack-positions-across-files.ts: programs of several files, ES modules, CommonJS and TypeScript, that take functions and classes from
// each other, in which each call in turn throws. They print the function, file, line and column of every frame.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/stack-positions-across-files";
import { generated } from "./generated/run-generated";

// Once plain Bun's optimizing compilers have taken a function into its caller, a stack trace there lists it even if it left by a tail call.
const plainEnv = { BUN_JSC_useDFGJIT: "0" };

generated(
  "a stack trace has the functions, files, lines and columns that plain Bun shows, whichever call of a program of several files throws",
  // Every run takes the first seeds; AOT_GENERATED=all takes all.
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    plainEnv,
    make: () => generate(new Random(index + 1)),
  })),
);
