// Fixed seeds of fuzz/json-texts-of-many-sizes-written-one-after-another-and-inside-each-other.ts: small programs that call `JSON.stringify` a few times in a row on values of very different sizes, with
// something in between or in the middle: a collection, a text that is given up half way, a `toJSON`, a getter or a replacer that itself calls `JSON.stringify`. Each text is what it would be alone.
import { generate } from "./fuzz/json-texts-of-many-sizes-written-one-after-another-and-inside-each-other";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "JSON texts of many sizes written one after another and inside each other",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more text would change what the others find.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
