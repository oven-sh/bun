// The same with two listeners: the list goes to the loop over them.
// STATISTIC: RestArrayAllocationsSunk >= 1
const { EventEmitter } = require("node:events");
const emitter = new EventEmitter();
let got = "";
emitter.on("a", function (...all) { got += "|" + all.length + all.join(); });
emitter.on("a", (x, y) => { got += "/" + x + y; });
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { got = ""; for (let i = 0; i < upTo[2]; i++) { emitter.emit("a"); emitter.emit("a", i); emitter.emit("a", i, turn); emitter.emit("a", i, turn, 3); emitter.emit("a", i, turn, 3, 4, 5); } return got; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
