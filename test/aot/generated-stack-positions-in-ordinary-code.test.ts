// Fixed seeds of fuzz/stack-positions-in-ordinary-code.ts: programs of ordinary code over several lines, in which each call in turn throws. They print the
// function, line and column of every frame.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/stack-positions-in-ordinary-code";
import { generated } from "./generated/run-generated";

// Once plain Bun's optimizing compilers have taken a function into its caller, a stack trace there lists it even if it left by a tail call.
const plainEnv = { BUN_JSC_useDFGJIT: "0" };

generated(
  "a stack trace has the functions, lines and columns that plain Bun shows, whichever call of a program throws",
  Array.from({ length: 300 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds and four of sloppy code; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12 || (index >= 200 && index < 204),
    isOnlyCompiled: true as const,
    plainEnv,
    make: () =>
      index >= 200
        ? { file: "main.cjs", text: generate(new Random(index + 1), false, false, true) }
        : index % 2 === 1
          ? { file: "main.ts", text: generate(new Random(index + 1), true) }
          : { file: "main.js", text: generate(new Random(index + 1)) },
  })),
);
