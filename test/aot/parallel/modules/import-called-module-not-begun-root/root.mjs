import "./a.mjs";
import "./b.mjs";
import("./a.mjs").then(() => console.log("root: a"));
let turns = Promise.resolve();
for (let turn = 1; turn < 16; turn++) turns = turns.then(() => console.log(turn));
