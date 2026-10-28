// Fixed seeds of fuzz/files-that-export-one-value-and-every-way-to-import-it.ts: files that end in `export = value` and files that import them by `import name = require(..)`, as the default,
// as a namespace, by the names of members, by `require(..)` and by `import(..)`. They print which files run, in which order, and what arrives.
import { generate } from "./fuzz/files-that-export-one-value-and-every-way-to-import-it";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "files that export one value and every way to import it",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", ...generate(new Random(index + 1)) }),
  })),
);
