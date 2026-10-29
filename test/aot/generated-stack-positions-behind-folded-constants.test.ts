// Fixed seeds of fuzz/stack-positions-behind-folded-constants.ts: functions that throw at a value which Bun's transpiler folds from a chain of variables. They print
// the line and column of the frame.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/stack-positions-behind-folded-constants";
import { generated } from "./generated/run-generated";

generated(
  "a stack trace has the line and column that plain Bun shows for a value folded from a chain of variables",
  // Every run takes the first seeds; AOT_GENERATED=all takes all.
  Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 8,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
