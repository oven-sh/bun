// Fixed seeds of fuzz/one-thing-under-two-declared-types-read-stored-to-and-read-again.ts: small TypeScript programs, which the type checker accepts, about one thing that has two names with two declared
// types (`readonly` and open, `as const`, a tuple and a list, a wide interface and a narrow one), or a type that a test has narrowed. It is read, stored to under the other name, and read again.
import { generate } from "./fuzz/one-thing-under-two-declared-types-read-stored-to-and-read-again";
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
  "one thing under two declared types, read, stored to and read again",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of either name would be one more thing known about it.
    keepsItsText: true as const,
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
