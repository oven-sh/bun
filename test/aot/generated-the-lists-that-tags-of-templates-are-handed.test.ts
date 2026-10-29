// Fixed seeds of fuzz/the-lists-that-tags-of-templates-are-handed.ts: tagged templates in every kind of function, reached straight and through other functions. One place in the source has one
// list of texts, however often and from wherever it runs, and two places never share one. They print a number for each list, its texts, and whether it can be changed.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/the-lists-that-tags-of-templates-are-handed";
import { generated } from "./generated/run-generated";

generated(
  "the lists that tags of templates are handed",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
  })),
);
