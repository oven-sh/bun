// "n" + name may be node:util: the load finds the module whole, also what no import names.
import { format } from "node:util";
const name = process.argv[5] ?? "ode:util";
console.log(format("%s", 1), require("n" + name).stripVTControlCharacters("b"));
