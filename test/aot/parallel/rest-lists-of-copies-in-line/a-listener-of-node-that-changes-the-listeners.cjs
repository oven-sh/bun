// A listener adds and removes listeners while it is called; once() too.
// STATISTIC: RestArrayAllocationsSunk >= 1
const { EventEmitter } = require("node:events");
const emitter = new EventEmitter();
let got = "";
function second(x) { got += "|second" + x; }
emitter.on("a", x => { got += "|first" + x; if (x === 1) emitter.on("a", second); if (x === 3) emitter.off("a", second); });
emitter.once("a", x => { got += "|once" + x; });
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { got = ""; for (let i = 0; i < upTo[5]; i++) emitter.emit("a", i, turn); return got + "/" + emitter.listenerCount("a"); }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
