// Programs of ../non-escaping-object-histories.ts, one per seed. That file describes them.
import { Random } from "../random";
import { generate } from "../non-escaping-object-histories";
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

export default endless("non escaping object histories", index => {
  const isTyped = index % 2 === 1;
  return {
    name: `seed ${index + 1}, ${isTyped ? "with types" : "without types"}.`,
    make: () => ({
      file: isTyped ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), isTyped),
      files: isTyped ? { "tsconfig.json": tsconfig } : undefined,
    }),
  };
});
