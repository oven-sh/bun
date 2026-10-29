// fuzz/switches-over-values-of-every-kind.ts: `switch` statements of two to three hundred clauses that are numbers, texts, constants, members of enums, symbols, objects and
// expressions, with `default` in every place, asked about values of every kind and their neighbors. They print which clauses run.
import { Random } from "../random";
import { generate, written } from "../switches-over-values-of-every-kind";
import { endless } from "../family";

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

export default endless("switches over values of every kind", index => {
  // Every tenth program ends with what plain Bun answers otherwise than the language says: there the answer of Node.js is written down.
  const hasWhatIsWritten = index % 10 === 9;
  return {
    name: `seed ${index + 1}.`,
    written: hasWhatIsWritten ? written : undefined,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1), hasWhatIsWritten),
      files: { "tsconfig.json": tsconfig },
    }),
  };
});
