// emit() of node:events stands in a small function that the loop calls; none to five values, one listener and then two.
// STATISTIC: RestArrayAllocationsSunk >= 1
const { EventEmitter } = require("node:events");
const emitter = new EventEmitter();
let got = "";
emitter.on("a", function (...all) { got += "|" + (this === emitter) + all.length + all.join(); });
function none() { return emitter.emit("a"); }
function one(i) { return emitter.emit("a", i); }
function three(i, turn) { return emitter.emit("a", i, turn, 3); }
function five(i, turn) { return emitter.emit("a", i, turn, 3, 4, 5); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { got = ""; for (let i = 0; i < upTo[2]; i++) got += none() + "" + one(i) + three(i, turn) + five(i, turn); if (turn === 1) emitter.on("a", x => { got += "/second" + x; }); return got; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
