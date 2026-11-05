// Two files re-export one name of an external package, and each folder has its own copy of the package: the loader finds two modules, so `export *` of both files makes the name ambiguous. It is no key of the namespace object, and a named import is a SyntaxError.
// Flags: --packages external
import * as all from "./index.js";

console.log("namespace:", "z" in all, all.z, Object.keys(all).join());
const name = ["z"].join("");
console.log("computed:", all[name], name in all);

try {
  await import("./named.js");
  console.log("the ambiguous name was imported");
} catch (error) {
  console.log("named:", error instanceof SyntaxError);
}
