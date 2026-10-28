// Fixed seeds of fuzz/symbols-made-at-one-place-of-the-text-and-used-as-keys.ts: small programs about symbols that one place of the text makes, once or several times (a function that is called twice, a
// loop, a class that is made twice, a file that two files import), and members that stand under them. Every call of `Symbol(..)` makes a new symbol, and two symbols are two keys.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/symbols-made-at-one-place-of-the-text-and-used-as-keys";
import { generated } from "./generated/run-generated";

generated(
  "symbols made at one place of the text and used as keys",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of a symbol would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
