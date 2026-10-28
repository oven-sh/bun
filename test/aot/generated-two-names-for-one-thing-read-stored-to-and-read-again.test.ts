// Fixed seeds of fuzz/two-names-for-one-thing-read-stored-to-and-read-again.ts: small programs about one thing that has two names, the second of which comes by one road: what a built-in answers, a
// proxy, two parameters, two views of one buffer, a namespace and an imported name, `arguments`. It is read under one name, stored to under the other and read again: the second read sees the store.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/two-names-for-one-thing-read-stored-to-and-read-again";
import { generated } from "./generated/run-generated";

generated(
  "two names for one thing, read, stored to and read again",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of either name would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
