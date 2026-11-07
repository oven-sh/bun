// A module of the program exports names of "bun:wrap" again, by name and by `export *`: they are the bindings of the one module that is compiled with the program, and a name it lacks is a SyntaxError.
// Env: BUN_JSC_crashIfInterpreterIsUsed=1
import { __toESM as byName, renamed } from "./named.js";
import { __toESM as throughStar } from "./stars.js";
import * as stars from "./stars.js";
import * as again from "./stars-again.js";
import * as wrap from "bun:wrap";
console.log("by name:", byName === wrap.__toESM, renamed === wrap.__using);
console.log("by star:", throughStar === wrap.__toESM, stars.__toESM === wrap.__toESM, stars.own, stars.__name, "default" in stars);
console.log("keys:", Object.keys(stars).length === Object.keys(wrap).length + 1, Object.keys(again).join() === Object.keys(stars).join(), again.__using === wrap.__using);
const loads = {
  "an import of a missing name": () => import("./missing-import.js"),
  "an export of a missing name": () => import("./missing-export.js"),
  "an import of the default": () => import("./default-import.js"),
};
for (const [what, load] of Object.entries(loads)) {
  try {
    await load();
    console.log(what, "was linked");
  } catch (error) {
    console.log(what + ":", error.name);
  }
}
/* Output:
by name: true true
by star: true true own the own name wins false
keys: true true true
an import of a missing name: SyntaxError
an export of a missing name: SyntaxError
an import of the default: SyntaxError
*/
