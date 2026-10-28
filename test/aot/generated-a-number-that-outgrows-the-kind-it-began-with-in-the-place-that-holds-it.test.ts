// Fixed seeds of fuzz/a-number-that-outgrows-the-kind-it-began-with-in-the-place-that-holds-it.ts: small programs about one number in one place (a member, a field, an element, a variable), which begins
// as a small whole number and is counted with, and one step that takes it past 32 bits, past 53 bits, to a fraction, `-0`, `NaN` or `Infinity`. Then it is read. Half of the programs are TypeScript.
import { generate } from "./fuzz/a-number-that-outgrows-the-kind-it-began-with-in-the-place-that-holds-it";
import { Random } from "./fuzz/random";
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
  "a number that outgrows the kind it began with in the place that holds it",
  Array.from({ length: 240 }, (_, index) => {
    const isTyped = index % 2 === 1;
    return {
      name: `seed ${index + 1}, ${isTyped ? "with types" : "without types"}.`,
      // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 24,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more use of the number would be one more thing known about it.
      keepsItsText: true as const,
      make: () => ({
        file: isTyped ? "main.ts" : index % 4 === 0 ? "main.cjs" : "main.mjs",
        text: generate(new Random(index + 1), isTyped),
        files: isTyped ? { "tsconfig.json": tsconfig } : undefined,
      }),
    };
  }),
);
