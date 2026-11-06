// fuzz/imports-that-may-be-only-types-and-whether-their-modules-run.ts: files import types, values and names that are both, in every form of import and export, and use them
// as types, as values or not at all. Every file says so when it runs, so the lines tell which imports bring their module along.
import { generate, options } from "../imports-that-may-be-only-types-and-whether-their-modules-run";
import { Random } from "../random";
import { endless } from "../family";

export default endless("imports that may be only types and whether their modules run", index => ({
  name: `seed ${index + 1}, ${options[index % options.length]}.`,
  make: () => ({ file: "main.ts", ...generate(new Random(index + 1), options[index % options.length]) }),
}));
