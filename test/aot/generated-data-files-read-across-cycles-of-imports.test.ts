// Fixed seeds of fuzz/data-files-read-across-cycles-of-imports.ts: ES modules that import one another in cycles read data files through each other's functions, ahead of the turns of those
// files. What a data file exports is there once its graph is loaded. An executable prints what plain Bun prints.
import { generate } from "./fuzz/data-files-read-across-cycles-of-imports";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "data files read across cycles of imports",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: which file runs when is the point.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
