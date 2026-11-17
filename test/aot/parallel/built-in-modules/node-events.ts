import * as library from "node:events";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
const emitter = new library.EventEmitter();
emitter.once("a", (value: number) => console.log(value));
console.log(emitter.emit("a", 5), emitter.emit("a", 6));
