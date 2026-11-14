// emit() of node:events in a loop, none to five values, one listener.
// STATISTIC: RestArrayAllocationsSunk >= 1
const { EventEmitter } = require("node:events");
const emitter = new EventEmitter();
let got = "";
emitter.on("a", function (...all) { got += "|" + (this === emitter) + all.length + all.join(); });
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { got = ""; for (let i = 0; i < upTo[2]; i++) { emitter.emit("a"); emitter.emit("a", i); emitter.emit("a", i, turn); emitter.emit("a", i, turn, 3); emitter.emit("a", i, turn, 3, 4); emitter.emit("a", i, turn, 3, 4, 5); } return got; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
