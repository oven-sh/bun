// A program that never names node:events comes by its EventEmitter.prototype, and by EventEmitter itself, by climbing from `process` behind a standard stream.
process.stdout.write("start\n");
const found = Object.getPrototypeOf(Object.getPrototypeOf(process));
const emitter = new found.constructor();
let heard = "";
emitter.once("madeUp", text => { heard += text; });
console.log(emitter.emit("madeUp", "one"), emitter.emit("madeUp", "two"), heard, found.constructor.name, typeof found.constructor.once);
