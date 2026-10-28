// Fixed seeds of fuzz/what-stands-on-the-prototypes-when-an-instance-is-made-stored-to-and-read.ts: small programs about one instance and one change to an object above it: an accessor, a member that
// cannot be written, a proxy or another object comes, or something goes, ahead of the making, inside it, behind it or behind a store. A field defines its member; a store asks the objects above first.
import { Random } from "../../fuzz/random";
import { generate } from "../../fuzz/what-stands-on-the-prototypes-when-an-instance-is-made-stored-to-and-read";
import { generated } from "../../generated/run-generated";

generated(
  "what stands on the prototypes when an instance is made, stored to and read",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the class would be one more thing known about it.
    keepsItsText: true as const,
    make: () => ({
      file: index % 3 === 0 ? "main.cjs" : "main.mjs",
      text: generate(new Random(index + 1)),
    }),
  })),
);
