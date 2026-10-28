// Fixed seeds of fuzz/this-of-functions-in-code-that-is-not-strict.ts: functions of a CommonJS file store into `this`, read it and hand it on.
// They are constructed, called plainly, called with every kind of value as `this`, used as methods and as callbacks of built-in functions.
// One seed in four has the same functions in strict code.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/this-of-functions-in-code-that-is-not-strict";
import { generated } from "./generated/run-generated";

generated(
  "`this` is in every function what it is in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    make: () => ({ file: "main.cjs", text: generate(new Random(index + 1), index % 4 === 3) }),
  })),
);
