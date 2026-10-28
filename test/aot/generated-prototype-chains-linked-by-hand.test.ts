// Fixed seeds of fuzz/prototype-chains-linked-by-hand.ts: constructor functions and classes whose prototype chains the program links
// itself (Object.setPrototypeOf, Object.create, __extends, util.inherits, a factory that takes the base); in the middle of the run the
// chain is linked anew, a method changes, or an instance moves to another chain. Every second seed is TypeScript.
import { generate } from "./fuzz/prototype-chains-linked-by-hand";
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
  "a prototype chain linked by hand answers like any other, also after it changes",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
