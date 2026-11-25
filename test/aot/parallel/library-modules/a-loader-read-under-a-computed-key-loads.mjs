// A loader that is read under a computed key loads a module of the library, as in `bun <file>`.
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
