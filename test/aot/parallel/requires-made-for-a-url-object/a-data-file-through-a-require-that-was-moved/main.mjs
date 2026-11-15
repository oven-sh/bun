// The folder that a moved URL names decides which data file the name finds. Compiled code refuses it aloud (docs/compiler/compatibility.mdx); the file beside the program is never taken for it.
import { createRequire } from "node:module";
const place = new URL(import.meta.url);
place.pathname = place.pathname.replace(/[^/]+$/, "other/start.mjs");
const load = createRequire(place);
let said;
try { said = load("./data.json").kind; } catch (e) { said = e.name + " " + e.code; }
console.log("the data file beside the program is taken for it:", said === "own");
