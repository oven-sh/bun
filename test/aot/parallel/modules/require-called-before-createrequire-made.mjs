// `var made = createRequire(..)`: a function that calls `made` runs once before the statement and once behind it. Before it the variable holds undefined, and the call throws a TypeError.
import { createRequire } from "node:module";
try { console.log(load()); } catch (error) { console.log(error.name); }
var made = createRequire(import.meta.url);
function load() { return made("node:path").sep; }
console.log(load());
