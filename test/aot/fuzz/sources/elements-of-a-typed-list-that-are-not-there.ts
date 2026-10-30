// fuzz/elements-of-a-typed-list-that-are-not-there.ts: small TypeScript programs, which the type checker accepts, about one list with a declared element type and one read of an element
// that is not there: past the end, below zero, in a hole, behind a `pop` or a shorter `length`. The read answers `undefined`, and what is then done with it goes as the language says.
import { generate } from "../elements-of-a-typed-list-that-are-not-there";
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

export default endless("elements of a typed list that are not there", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
