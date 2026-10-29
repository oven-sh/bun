// fuzz/types-written-inside-expressions-in-every-place.ts: `as`, `as const`, `satisfies`, `!`, `<T>value` and type arguments round targets of assignments, callees, links of
// optional chains, functions that take their names from where they stand, operands, keys and everything else. None of them does anything when the program runs.
import { Random } from "../random";
import { generate } from "../types-written-inside-expressions-in-every-place";
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

export default endless("types written inside expressions in every place", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
