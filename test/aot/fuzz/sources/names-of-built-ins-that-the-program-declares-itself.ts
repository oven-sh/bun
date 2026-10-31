// fuzz/names-of-built-ins-that-the-program-declares-itself.ts: variables, parameters, functions, classes and imports named `Math`, `JSON`, `Object`, `console`, `undefined` and so on.
// Inside the declaration's scope the name means what the program declared; ahead of it, behind it and in other files it means the built-in.
import { generate } from "../names-of-built-ins-that-the-program-declares-itself";
import { Random } from "../random";
import { endless } from "../family";

export default endless("names of built-ins that the program declares itself", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
