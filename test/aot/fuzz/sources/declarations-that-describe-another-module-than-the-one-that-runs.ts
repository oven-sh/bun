// fuzz/declarations-that-describe-another-module-than-the-one-that-runs.ts: small programs in which TypeScript imports a module of JavaScript whose declarations describe it rightly, wrongly, in part
// or as another version of it was: literal types, constants that change, other names and parameters, a class for a function, `value is T`, `asserts`, `never`, overloads, generic functions, enums, promises, the
// fields of a class, `export =`, augmentations. The declarations lie beside the file, in a package, under @types or in a `declare module`, some with invalid declarations beside them under `skipLibCheck`.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { generate, said } from "../declarations-that-describe-another-module-than-the-one-that-runs";
import { Random } from "../random";
import { endless } from "../family";

export default endless("declarations that describe another module than the one that runs", index => {
  const what = said[index % said.length];
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}, ${what}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), what),
  };
});
