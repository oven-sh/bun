// Fixed seeds of fuzz/classes-that-one-function-makes-below-whatever-it-is-handed.ts: small programs about one function that is handed a class and answers with a class below it, and two or three classes
// that it makes. Every call evaluates the class anew: other classes above, other private names, and `super` in each leads to its own class above.
import { generate } from "./fuzz/classes-that-one-function-makes-below-whatever-it-is-handed";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "classes that one function makes below whatever it is handed",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more call of the function would be one more class.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
