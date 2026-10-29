// Two of three imported CommonJS files queue a tick, and the second also a promise job. Both ticks run behind the second file, the job behind the third, and the tick of this module last. Plain Bun prints another output.
import "./first.cjs";
import "./second.cjs";
import "./third.cjs";
console.log("main runs");
process.nextTick(() => console.log("tick of main"));
