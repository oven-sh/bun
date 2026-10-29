// fuzz/typed-fields-and-lists-filled-by-another-file-and-read-in-long-loops.ts: small programs of three to six files. One file of TypeScript declares what holds values of a written type: a list,
// instances with a typed field, a variable, generic boxes, a map, a static or private field, a closure, a function that takes them. Another file, of JavaScript or of TypeScript that hides it from the checker,
// puts one value of another kind there, ahead of the loop or in the middle of it. A third file reads what is held in a loop of ten thousand turns. TypeScript accepts every program, so every build succeeds, and
// the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "../random";
import { generate } from "../typed-fields-and-lists-filled-by-another-file-and-read-in-long-loops";
import { endless } from "../family";

export default endless("typed fields and lists filled by another file and read in long loops", index => {
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1)),
  };
});
