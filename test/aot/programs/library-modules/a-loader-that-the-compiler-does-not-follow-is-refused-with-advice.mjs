// A loader that is read under a computed key, or that stands behind a proxy, is not followed by the compiler. In a program where every import path is a constant the call is refused, also for
// a module that is in the executable. The error can be caught, and it says what to write instead.
import { join } from "node:path";
console.log(join("a", "b"));
const name = ["node:", "path"].join("");
for (const load of [() => process[["get", "Builtin", "Module"].join("")](name), () => new Proxy(process.getBuiltinModule, {})(name)]) {
  try {
    console.log(typeof load().basename);
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}
