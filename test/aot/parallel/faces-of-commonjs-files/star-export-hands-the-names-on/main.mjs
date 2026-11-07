// an ES module hands on all names of a CommonJS file by a star, and another reads them by name and under computed keys
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the face finds is held against what Link says of it
import * as all from "./middle.mjs";
import { sum } from "./middle.mjs";
import "./start.cjs";
let out = Object.keys(all).sort().join() + ";";
for (let i = 0; i < 3; i++) out += sum("n", i) + all["su" + "m"]([i], "") + ";";
console.log(out);
