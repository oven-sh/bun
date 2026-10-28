// Fixed seeds of fuzz/what-is-walked-changes-while-it-is-walked.ts: small programs about one thing that is walked (a list, a `Map`, a `Set`, an object, a typed array over a buffer that can be resized) and
// one change that is made to it in the middle of the walk, by the body of the loop, the callback or a function that it calls.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-is-walked-changes-while-it-is-walked";
import { generated } from "./generated/run-generated";

generated(
  "what is walked changes while it is walked",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of what is walked would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
