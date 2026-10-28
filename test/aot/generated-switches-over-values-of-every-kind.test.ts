// Fixed seeds of fuzz/switches-over-values-of-every-kind.ts: `switch` statements of two to three hundred clauses that are numbers, texts, constants, members of enums, symbols, objects and
// expressions, with `default` in every place, asked about values of every kind and their neighbors. They print which clauses run.
import { Random } from "./fuzz/random";
import { generate, written } from "./fuzz/switches-over-values-of-every-kind";
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
  "switches over values of every kind",
  Array.from({ length: 120 }, (_, index) => {
    // Every tenth program ends with what plain Bun answers otherwise than the language says: there the answer of Node.js is written down.
    const hasWhatIsWritten = index % 10 === 9;
    return {
      name: `seed ${index + 1}.`,
      // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 12,
      isOnlyCompiled: true as const,
      written: hasWhatIsWritten ? written : undefined,
      make: () => ({
        file: "main.ts",
        text: generate(new Random(index + 1), hasWhatIsWritten),
        files: { "tsconfig.json": tsconfig },
      }),
    };
  }),
);
