// Fixed seeds of fuzz/imports-that-may-be-only-types-and-whether-their-modules-run.ts: files import types, values and names that are both, in every form of import and export, and use them
// as types, as values or not at all. Every file says so when it runs, so the lines tell which imports bring their module along.
import { generate, options } from "./fuzz/imports-that-may-be-only-types-and-whether-their-modules-run";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "imports that may be only types and whether their modules run",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}, ${options[index % options.length]}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", ...generate(new Random(index + 1), options[index % options.length]) }),
  })),
);
