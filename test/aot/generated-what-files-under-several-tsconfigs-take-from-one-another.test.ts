// Fixed seeds of fuzz/what-files-under-several-tsconfigs-take-from-one-another.ts: the files of a project lie under several tsconfig.json files and take from one another what each says of
// itself, constants made of that, packages with a file for `import` and one for `require`, and a `require` that gets paths from the folders of its callers. An executable prints what plain Bun prints.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-files-under-several-tsconfigs-take-from-one-another";
import { generated } from "./generated/run-generated";

generated(
  "what files under several tsconfigs take from one another",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // It asks which file the executable was started as.
    isBuiltAlone: true as const,
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
