import { createRequire } from "node:module";
const place = new URL(import.meta.url);
const load = createRequire(place);
let said;
try { said = load("./data.json").kind; } catch (e) { said = e.name + " " + e.code; }
console.log(said);
