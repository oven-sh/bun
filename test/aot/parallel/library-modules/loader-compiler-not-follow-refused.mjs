// A loader that is read under a computed key is not followed by the compiler. In a program where every import path is a constant the call is refused, also for
// a module that is in the executable. The error can be caught, and it says what to write instead.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import { posix } from "node:path";
console.log(posix.join("a", "b"));
const name = ["node:", "path"].join("");
for (const load of [() => process[["get", "Builtin", "Module"].join("")](name)]) {
  try {
    console.log(typeof load().basename);
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}
/* Output:
a/b
Error: Cannot load 'node:path': this executable can't load a module from a dynamic path. The compiler couldn't tell at build time that this call reaches a module loader. Call require(), import() or process.getBuiltinModule() directly. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
