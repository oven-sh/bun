// `path.join(name, ".")` and `path.join("./", name)` answer the name.
// Env: NAME=util
import path from "node:path";
import { format } from "node:util";
const name = process.env.NAME;
console.log(format("%s", 1), require(path.join(name, ".")).stripVTControlCharacters("b"));
console.log(require(path.join("./", name)).stripVTControlCharacters("c"));
