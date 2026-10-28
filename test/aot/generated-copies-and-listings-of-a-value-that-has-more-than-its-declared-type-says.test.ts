// Fixed seeds of fuzz/copies-and-listings-of-a-value-that-has-more-than-its-declared-type-says.ts: small TypeScript programs, which the type checker accepts, about one function with a parameter of a
// declared object type and one value that fits the type but has more members, another order, accessors, members above it or hidden ones. The function copies or lists what it is handed.
import { generate } from "./fuzz/copies-and-listings-of-a-value-that-has-more-than-its-declared-type-says";
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
  "copies and listings of a value that has more than its declared type says",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more call of the function would be one more thing known about its parameter.
    keepsItsText: true as const,
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
