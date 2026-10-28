// Fixed seeds of fuzz/who-is-called-when-the-name-of-a-function-is-stored-to-while-it-runs.ts: small programs about one function, method or class and one store to the name by which it is called, made
// while a call of it runs: in its body, in an argument, in a default, in a `finally`, in what the caller hands in. A call takes what the name holds when its callee is evaluated.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/who-is-called-when-the-name-of-a-function-is-stored-to-while-it-runs";
import { generated } from "./generated/run-generated";

generated(
  "who is called when the name of a function is stored to while it runs",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more call of the function would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
