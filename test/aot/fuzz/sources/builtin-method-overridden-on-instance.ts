// Programs of ../builtin-method-overridden-on-instance.ts, one per seed. That file describes them.
import { generate } from "../builtin-method-overridden-on-instance";
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

export default endless("builtin method overridden on instance", index => {
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
