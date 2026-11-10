import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const place = new URL(import.meta.url);
const load = createRequire(dirname(fileURLToPath(place)) + "/");
let said;
try { said = load("./part.cjs").kind; } catch (e) { said = e.name + " " + e.code; }
console.log(said);
