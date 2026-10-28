// Fixed seeds of fuzz/closures-that-leave-the-function-that-made-them-by-one-road.ts: small programs about one function that makes a closure over its own variables and lets it out by one road alone: it
// is thrown, yielded, bound, captured, handed to a built-in. Other functions run, a collection runs, and then the closures are called: each still finds the variables of the call that made it.
import { generate } from "./fuzz/closures-that-leave-the-function-that-made-them-by-one-road";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "closures that leave the function that made them by one road",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the closure would be one more road out.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
