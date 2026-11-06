// fuzz/resources-declared-with-using-wherever-a-declaration-may-stand.ts: `using` and `await using` over resources of every kind, in every place where a declaration may stand,
// left in every way. They print the order of everything, what is thrown with every `SuppressedError` taken apart, and how many jobs pass.
import { Random } from "../random";
import { generate } from "../resources-declared-with-using-wherever-a-declaration-may-stand";
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

export default endless("resources declared with using wherever a declaration may stand", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
