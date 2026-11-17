// No listener; and the event "error", with a listener and without one.
const { EventEmitter } = require("node:events");
const emitter = new EventEmitter();
let got = "";
const names = JSON.parse('["none","error","a"]');
emitter.on("a", x => { got += "|a" + x; });
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { got = ""; for (let i = 0; i < upTo[3]; i++) { try { got += "|" + emitter.emit(names[i], turn === 1 ? new Error("told" + i) : i, turn); } catch (error) { got += "|thrown " + error.message; } } if (turn === 0) emitter.on("error", (...all) => { got += "|heard" + all.length; }); return got; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
