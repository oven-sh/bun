// Fixed seeds of fuzz/elements-of-a-typed-list-that-are-not-there.ts: small TypeScript programs, which the type checker accepts, about one list with a declared element type and one read of an element
// that is not there: past the end, below zero, in a hole, behind a `pop` or a shorter `length`. The read answers `undefined`, and what is then done with it goes as the language says.
import { generate } from "./fuzz/elements-of-a-typed-list-that-are-not-there";
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
  "elements of a typed list that are not there",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the list would be one more thing known about it.
    keepsItsText: true as const,
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
