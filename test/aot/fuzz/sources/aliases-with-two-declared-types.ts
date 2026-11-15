// Programs of ../aliases-with-two-declared-types.ts, one per seed. That file describes them.
import { generate } from "../aliases-with-two-declared-types";
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

export default endless("aliases with two declared types", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
