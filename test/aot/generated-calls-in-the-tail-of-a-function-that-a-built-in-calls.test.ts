// Fixed seeds of fuzz/calls-in-the-tail-of-a-function-that-a-built-in-calls.ts: small programs about one call in the tail of a function of the program that a built-in calls (a getter, `valueOf`, `toJSON`, a
// trap, a callback): `return target(..)` with none to twenty arguments. The target gets what is written, the built-in gets the answer, and the variables round the built-in are what they were.
import { generate } from "./fuzz/calls-in-the-tail-of-a-function-that-a-built-in-calls";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "calls in the tail of a function that a built-in calls",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more call of the target would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
