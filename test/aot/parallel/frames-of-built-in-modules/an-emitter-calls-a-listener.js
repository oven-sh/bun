// Under: --sourcemap=external: the frames of the program point into the map, those of a built-in module do not
// Under: --obfuscate: the frames of the program have no names, those of a built-in module have theirs
const { EventEmitter } = require("node:events");

const framesOfBuiltIns = stack =>
  stack
    .split("\n")
    .map(line => line.trim().replace(/:\d+:\d+\)$/, ")"))
    .filter(line => /\((?:node:events|native)\)$/.test(line));

class Emitter extends EventEmitter {}
const emitter = new Emitter();
emitter.on("stack", () => console.log(framesOfBuiltIns(new Error("from a listener").stack)));
emitter.emit("stack");
emitter.once("once", () => console.log(framesOfBuiltIns(new Error("from a listener").stack)));
emitter.emit("once");
[1].forEach(() => console.log(framesOfBuiltIns(new Error("from forEach").stack)));
try {
  emitter.on("stack", 1);
} catch (error) {
  console.log(error.code, framesOfBuiltIns(error.stack));
}

let seen = new Map();
emitter.on("loop", turn => {
  const key = framesOfBuiltIns(new Error("from a loop").stack).join();
  seen.set(key, (seen.get(key) ?? 0) + turn);
});
for (let outer = 0; outer < 3; outer++) {
  for (let turn = 0; turn < 100; turn++) emitter.emit("loop", turn);
}
console.log(seen);
