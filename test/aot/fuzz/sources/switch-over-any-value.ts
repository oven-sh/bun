// Programs of ../switch-over-any-value.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../switch-over-any-value";
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
  // Every tenth program ends with an earlier clause that uses a function of a later clause.
  const hasLaterClauseFunction = index % 10 === 9;
  return {
    name: `seed ${index + 1}.`,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1), hasLaterClauseFunction),
      files: { "tsconfig.json": tsconfig },
    }),
  };
});
