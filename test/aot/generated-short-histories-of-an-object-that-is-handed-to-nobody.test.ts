// Fixed seeds of fuzz/short-histories-of-an-object-that-is-handed-to-nobody.ts: small programs about one object that no function of the program is handed, changed in a few of a hundred ways and read
// beside each change: in one call, one sum, one template, on both sides, in a loop, in the next statement. Every line is printed at once. Half of the programs have written types.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/short-histories-of-an-object-that-is-handed-to-nobody";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});

generated(
  "short histories of an object that is handed to nobody",
  Array.from({ length: 240 }, (_, index) => {
    const isTyped = index % 2 === 1;
    return {
      name: `seed ${index + 1}, ${isTyped ? "with types" : "without types"}.`,
      // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 24,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: whatever a run adds would be handed the object or stand between a change and a read.
      keepsItsText: true as const,
      make: () => ({
        file: isTyped ? "main.ts" : "main.js",
        text: generate(new Random(index + 1), isTyped),
        files: isTyped ? { "tsconfig.json": tsconfig } : undefined,
      }),
    };
  }),
);
