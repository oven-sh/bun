// Fixed seeds of fuzz/closures-in-fields-replaced-from-outside.ts: a closure kept in a field is replaced by code that knows nothing about
// the object, and calls, comparisons and marks through typed readers answer as in plain Bun. Every second seed is TypeScript.
import { generate } from "./fuzz/closures-in-fields-replaced-from-outside";
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

// Every run takes these, whatever else it takes.
const onceWrong = [13, 21, 51, 55, 57, 91];

generated(
  "closures in fields that are replaced from outside answer as in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds and five more that write one field only through a parameter typed as another class;
    // AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16 || [21, 51, 55, 57, 91].includes(index + 1),
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-cold"] : index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
