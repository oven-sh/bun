// Two files re-export one name of one external package, and a third passes both on with `export *`: the loader finds one module, so the name is one binding, for a named import and as a key of the namespace object.
// Flags: --packages external
import { z, a, b } from "./index";
import * as all from "./index";

console.log("named:", z.label, a, b);
console.log("namespace:", all.z === z, Object.keys(all).join());
const name = ["z"].join("");
console.log("computed:", Reflect.get(all, name) === z, name in all);
