// Each file has a `__dirname` and a `__filename` of its own, whenever they are read, and a file asked for by such a path is the one that the program holds.
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { where } from "./lib/inner.mjs";
const require = createRequire(import.meta.url);
console.log(basename(__dirname), basename(__filename));
console.log(where().map(path => basename(path)).join());
console.log(require(join(__dirname, "lib", "common.cjs")) === require("./lib/common.cjs"));
console.log(require(__dirname + "/lib/common.cjs").folder === join(__dirname, "lib"));
console.log((await import(join(__dirname, "lib", "inner.mjs"))).where === where);
