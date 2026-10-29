// The first module of the graph calls import() on the second before the second has begun, the second on the entry point, and the entry point on the first.
// A chain of jobs shows in which turn each of the three promises settles.
import "./a.mjs";
import "./b.mjs";
import("./a.mjs").then(() => console.log("main: a"));
let turns = Promise.resolve();
for (let turn = 1; turn < 16; turn++) turns = turns.then(() => console.log(turn));
