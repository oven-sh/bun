// A ring of two files: the class of the file that is imported runs first, and the var of the importer is not filled yet.
import { Crate } from "./crate.mjs";
export var LABEL = "weigh";
const crate = new Crate();
let sum = 0;
for (let i = 0; i < 300; i++) sum = (sum + crate.plain()) | 0;
console.log(typeof crate.weigh, typeof crate["undefined"], sum);
