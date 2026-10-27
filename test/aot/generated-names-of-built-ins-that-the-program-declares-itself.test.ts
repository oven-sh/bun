// Fixed seeds of fuzz/names-of-built-ins-that-the-program-declares-itself.ts: variables, parameters, functions, classes and imports named `Math`, `JSON`, `Object`, `console`, `undefined` and so on.
// Inside the declaration's scope the name means what the program declared; ahead of it, behind it and in other files it means the built-in.
import { generate } from "./fuzz/names-of-built-ins-that-the-program-declares-itself";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "names of built-ins that the program declares itself",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
  })),
);
