// Prints what another module's variables hold, each of which is declared by `export var` and again by `var`.
import * as all from "./variables.mjs";
import { a, c, d, g, l, q, s, u, x, z } from "./variables.mjs";
console.log(a, c, d, g, l, q(), s, u, x, z);
for (const name of Object.keys(all)) console.log(name, typeof all[name] === "function" ? "function" : all[name]);
