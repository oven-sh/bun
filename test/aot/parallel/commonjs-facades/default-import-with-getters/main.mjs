// STATISTIC: AccessesProven >= 3
import lib from "./lib.cjs";
import { named, log } from "./user.mjs";
console.log(log().join("\n"));
console.log(lib.run(20), lib.value.sum(), named.sum(), lib.counter, lib.missing);
let sum = 0;
for (let i = 0; i < 40; i++) sum += new lib.Point(i, lib.make(i).sum()).sum();
console.log(sum, lib.counter, Object.keys(lib).join());
try { lib.broken; } catch (error) { console.log(error.message); }
