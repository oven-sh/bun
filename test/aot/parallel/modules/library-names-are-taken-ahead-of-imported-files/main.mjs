import "./patch.cjs";
import fs from "node:fs";
import { existsSync } from "node:fs";
import * as namespace from "node:fs";
import { existsSync as handedOn } from "./names.mjs";

// The loader took the names of node:fs ahead of the file, and the default export is the object that the file changed.
console.log(existsSync("x"), namespace.existsSync("x"), handedOn("x"));
console.log(fs.existsSync("x"), namespace.addedByPatch, fs.addedByPatch());

const late = await import("node:os");
console.log(typeof late.hostname);

// The runner's reference has the async transpiler off, and there patch.cjs runs while it is fetched, ahead of node:fs. What plain Bun does by default is this:
/* Output:
patch ran
false false false
patched undefined added
function
*/
