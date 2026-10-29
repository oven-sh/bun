// Fixed seeds of fuzz/names-given-by-key-with-something-done-in-between.ts: objects of many births are given names by key, from one to eleven hundred, most of them
// literal texts that are another one in each turn; between two such stores a name is defined anew, deleted, or the object is closed or put below another; then a collection.
// Every third seed is TypeScript.
import { generate } from "./fuzz/names-given-by-key-with-something-done-in-between";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: ["bun-types"],
  },
});

generated(
  "a name given by key stays, whatever was done to the object before the next one",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds and three more; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12 || [17, 21, 82].includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: (index + 1) % 3 === 1 ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), (index + 1) % 3 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
