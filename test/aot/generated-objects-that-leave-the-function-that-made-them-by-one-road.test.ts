// Fixed seeds of fuzz/objects-that-leave-the-function-that-made-them-by-one-road.ts: small programs about one function that makes an object and lets it out by one road alone: it is thrown, yielded,
// bound, captured, handed to a built-in, or a member of its own stores `this`. Other functions run, a collection runs, and then the objects are read: each still holds what it was made with.
import { generate } from "./fuzz/objects-that-leave-the-function-that-made-them-by-one-road";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "objects that leave the function that made them by one road",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the object would be one more road out.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
