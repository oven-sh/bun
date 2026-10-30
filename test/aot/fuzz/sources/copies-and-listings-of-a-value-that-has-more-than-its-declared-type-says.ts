// fuzz/copies-and-listings-of-a-value-that-has-more-than-its-declared-type-says.ts: small TypeScript programs, which the type checker accepts, about one function with a parameter of a
// declared object type and one value that fits the type but has more members, another order, accessors, members above it or hidden ones. The function copies or lists what it is handed.
import { generate } from "../copies-and-listings-of-a-value-that-has-more-than-its-declared-type-says";
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

export default endless("copies and listings of a value that has more than its declared type says", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
