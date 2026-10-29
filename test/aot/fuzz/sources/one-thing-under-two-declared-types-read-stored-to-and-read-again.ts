// fuzz/one-thing-under-two-declared-types-read-stored-to-and-read-again.ts: small TypeScript programs, which the type checker accepts, about one thing that has two names with two declared
// types (`readonly` and open, `as const`, a tuple and a list, a wide interface and a narrow one), or a type that a test has narrowed. It is read, stored to under the other name, and read again.
import { generate } from "../one-thing-under-two-declared-types-read-stored-to-and-read-again";
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

export default endless("one thing under two declared types, read, stored to and read again", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
}));
