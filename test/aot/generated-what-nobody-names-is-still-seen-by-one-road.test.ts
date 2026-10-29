// Fixed seeds of fuzz/what-nobody-names-is-still-seen-by-one-road.ts: small programs in which a field, a parameter, a result, a variable, a method, a class or an export is written that no other place
// names, and one road still sees it or what its making does: a listing, a copy, a computed key, `arguments`, a protocol of the language. Every line is printed at once.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-nobody-names-is-still-seen-by-one-road";
import { generated } from "./generated/run-generated";

generated(
  "what nobody names is still seen by one road",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: it would be one more road.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
