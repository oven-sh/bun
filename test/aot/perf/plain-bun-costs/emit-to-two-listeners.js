const { EventEmitter } = require("node:events");
let heard = 0,
  answered = 0;
const emitter = new EventEmitter();
emitter.on("x", a => {
  heard += a === undefined ? 1 : a & 1;
});
emitter.on("x", (a, b) => {
  heard += b === undefined ? 1 : b & 1;
});
for (let i = 0; i < 500000; i++) if (emitter.emit("x")) answered++;
for (let i = 0; i < 500000; i++) if (emitter.emit("x", i)) answered++;
for (let i = 0; i < 500000; i++) if (emitter.emit("x", i, i, i, i)) answered++;
console.log(heard, answered);
