// Fixed seeds of fuzz/the-member-named-default-between-commonjs-files-and-es-modules.ts: the file below holds a member named `default`, is one value or has no such member, as a CommonJS file with and without
// `__esModule`, an ES module or JSON; a CommonJS file above it hands that member on, as compilers emit `export { default } from` with and without their helpers or as it is written by hand, under the name `default`
// or another one; the program takes it by a default import, by name, off the namespace, by `require` or `import()`, straight or through ES modules, and prints what it got. TypeScript accepts every program, so
// every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "../random";
import { corners, generate } from "../the-member-named-default-between-commonjs-files-and-es-modules";
import { family } from "../family";

export default family(
  "the member named default between CommonJS files and ES modules",
  Array.from({ length: corners.length * 24 }, (_, index) => {
    const corner = corners[index % corners.length];
    // The corners are a multiple of three, so the turn moves on by one with every row of them.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
