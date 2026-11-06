// createRequire reaches its call through a field, and the require it makes finds a compiled file by a constant path.
import { createRequire } from "node:module";
const load = { held: createRequire }.held(import.meta.url);
console.log(load("./a.cjs") === require("./a.cjs"), load("./a.cjs") === import.meta.require("./a.cjs"), load("./a.cjs").a);
