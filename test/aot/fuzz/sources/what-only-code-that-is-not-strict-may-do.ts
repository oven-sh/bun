// fuzz/what-only-code-that-is-not-strict-may-do.ts: a CommonJS file in sloppy mode: an `arguments` object that shares its elements with the parameters, stores to names nobody declared,
// stores that do nothing, `delete` of names, `with`, a direct `eval` that declares variables, octal numbers, `this`, `arguments` and `return` at the top of the file.
import { Random } from "../random";
import { generate } from "../what-only-code-that-is-not-strict-may-do";
import { endless } from "../family";

export default endless("what only code that is not strict may do", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.cjs", text: generate(new Random(index + 1)) }),
}));
