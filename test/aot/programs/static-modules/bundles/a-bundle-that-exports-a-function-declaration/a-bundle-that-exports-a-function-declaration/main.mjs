// A bundle that is an ES module, reads Object.getOwnPropertyNames in its prelude and exports a function declaration.
// STATISTIC: ModulesWithNames >= 3
import { run } from "./lib.mjs";
var sum = 0;
for (var round = 0; round < 1000; round++) sum += run(round);
console.log(run(2), run(1), sum);
