// Fixed seeds of fuzz/private-names-laid-on-objects-that-the-class-did-not-make-itself.ts: small programs about one class with private names whose instances are made by a built-in class above it, or by a
// class above that hands back an object it was given. A few instances are made in a row, one of them is odd, and then the names are read, stored to and tested on each.
import { generate } from "./fuzz/private-names-laid-on-objects-that-the-class-did-not-make-itself";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "private names laid on objects that the class did not make itself",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more making would be one more thing known about the class.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
