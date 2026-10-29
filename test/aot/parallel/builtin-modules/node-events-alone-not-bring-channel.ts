// node:events puts its EventEmitter.prototype above the native prototype of `process`, on which the native listener methods lie. The functions of builtins/Ipc, and with them node:net, node:dgram,
// node:fs and the streams, hang on those methods for a call on `process` with the event "message" or "disconnect". An emitter of the program that listens for them, and a listener for another event
// on `process`, bring none of that: 800 functions where there were 6,000.
// STATISTIC: ImageFunctionsEmitted <= 2000
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.on("message", (text: string) => console.log("got", text));
emitter.once("disconnect", () => console.log("disconnected"));
console.log(emitter.emit("message", "one"), emitter.emit("disconnect"), emitter.emit("disconnect"), emitter.listenerCount("message"));
process.on("exit", code => console.log("exit", code, process.listenerCount("exit"), process.listenerCount("message")));
console.log(Object.getPrototypeOf(Object.getPrototypeOf(process)) === EventEmitter.prototype);
