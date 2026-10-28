// Fixed seeds of fuzz/exports-that-change-and-the-namespaces-that-show-them.ts: ES modules whose exports change while the program runs, files that hand exports on under the same and other names,
// and the namespace objects that show them: their keys, attributes and what may be done to them. Every importer sees each change at once.
import { generate } from "./fuzz/exports-that-change-and-the-namespaces-that-show-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "exports that change and the namespaces that show them",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
  })),
);
