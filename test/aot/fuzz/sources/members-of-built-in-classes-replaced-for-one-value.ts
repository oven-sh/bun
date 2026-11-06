// fuzz/members-of-built-in-classes-replaced-for-one-value.ts: small programs about one value of a built-in class for which one member is replaced, by a class below, a member of its own
// or another prototype, and which is then used where the language asks that member: calls, spreads, loops, patterns, conversions, `await`, JSON, other built-ins. Half of the programs have written types.
import { generate } from "../members-of-built-in-classes-replaced-for-one-value";
import { Random } from "../random";
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

export default endless("members of built-in classes replaced for one value", index => {
  const isTyped = index % 2 === 1;
  return {
    name: `seed ${index + 1}, ${isTyped ? "with types" : "without types"}.`,
    make: () => ({
      file: isTyped ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), isTyped),
      files: isTyped ? { "tsconfig.json": tsconfig } : undefined,
    }),
  };
});
