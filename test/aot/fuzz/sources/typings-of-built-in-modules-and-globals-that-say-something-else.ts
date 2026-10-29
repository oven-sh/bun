// fuzz/typings-of-built-in-modules-and-globals-that-say-something-else.ts: small programs that use one member of a built-in module or one global of Bun under typings that say something else about it
// than what it is: an @types/node of another version, a `declare module` or a declaration of the global in the project. TypeScript accepts every program, so every build succeeds. What runs is Bun's own member, and
// the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "../random";
import { generate } from "../typings-of-built-in-modules-and-globals-that-say-something-else";
import { endless } from "../family";

export default endless("typings of built-in modules and globals that say something else", index => {
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1)),
  };
});
