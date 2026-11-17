import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const place = new URL(import.meta.url);
place.pathname = place.pathname.replace(/[^/]+$/, "other/start.mjs");
const load = createRequire(dirname(fileURLToPath(place)) + "/");
let said;
try { said = load("./part.cjs").kind; } catch (e) { said = e.name + " " + e.code; }
console.log("the file beside the program is taken for it:", said === "own");
