// fuzz/what-the-code-behind-a-declaration-file-is-given-against-what-the-file-says.ts: a declaration file says what a function of a file of JavaScript is given, TypeScript calls it with that, and one call
// that TypeScript does not check (out of JavaScript, behind `as any`, `// @ts-ignore` or `JSON.parse`, by a built-in, by a package without typings, under a wider name) hands it something else.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "../random";
import { corners, generate } from "../what-the-code-behind-a-declaration-file-is-given-against-what-the-file-says";
import { endless } from "../family";

export default endless("what the code behind a declaration file is given against what the file says", index => {
  const corner = corners[index % corners.length];
  // The corners are a multiple of three, so the turn moves on by one with every row of them.
  const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
  return {
    name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), corner),
  };
});
