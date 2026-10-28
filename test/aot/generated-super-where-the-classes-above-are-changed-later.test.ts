// Fixed seeds of fuzz/super-where-the-classes-above-are-changed-later.ts: classes that use `super.name` and `super(..)` in every place, while the program changes the prototypes of the class and of its
// `prototype`, and replaces, deletes and adds members above. `super` asks what stands above at that moment.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/super-where-the-classes-above-are-changed-later";
import { generated } from "./generated/run-generated";

generated(
  "super where the classes above are changed later",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
