// Programs of ../switch-over-any-value.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate, specified } from "../switch-over-any-value";
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

export default endless("switch over any value", index => {
  // Every tenth program ends with cases where plain Bun deviates from the specification; their expected output is
  // Node.js's.
  const hasSpecifiedLines = index % 10 === 9;
  return {
    name: `seed ${index + 1}.`,
    specified: hasSpecifiedLines ? specified : undefined,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1), hasSpecifiedLines),
      files: { "tsconfig.json": tsconfig },
    }),
  };
});
