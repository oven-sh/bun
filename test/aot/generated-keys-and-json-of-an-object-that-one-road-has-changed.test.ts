// Fixed seeds of fuzz/keys-and-json-of-an-object-that-one-road-has-changed.ts: small programs about one object with three members, one change to their order, their attributes or what stands above
// them, made on one road, and one listing: keys, values, entries, `for in`, JSON, copies, the rest of a pattern, descriptors. The object is alone, or beside a twin that is not changed.
import { generate } from "./fuzz/keys-and-json-of-an-object-that-one-road-has-changed";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "keys and JSON of an object that one road has changed",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the object would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
