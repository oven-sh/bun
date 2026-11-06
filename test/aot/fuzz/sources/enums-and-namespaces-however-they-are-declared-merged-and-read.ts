// fuzz/enums-and-namespaces-however-they-are-declared-merged-and-read.ts: enums and namespaces of every form, alone, in several declarations and beside functions, classes and enums
// of their names; their members are read by name, under keys and ahead of the declaration, and the objects are listed, written as JSON and changed.
import { generate } from "../enums-and-namespaces-however-they-are-declared-merged-and-read";
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

export default endless("enums and namespaces however they are declared, merged and read", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
