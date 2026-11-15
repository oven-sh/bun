// one module imports the default of a CommonJS file by a statement, and gets the namespace object by import() too
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the facade finds is held against what Link says of it
import sum from "./sum.cjs";
import "./start.cjs";
const all = await import("./sum.cjs");
let out = String(all.default === sum) + ";";
for (const key of Object.keys(all)) out += key + ":" + (typeof all[key] === "function" ? all[key]("k", 1) : typeof all[key]) + ";";
console.log(out);
