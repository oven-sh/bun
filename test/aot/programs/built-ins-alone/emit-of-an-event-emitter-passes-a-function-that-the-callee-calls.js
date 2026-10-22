import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
emitter.on("ready", target);
emitter.emit("ready", report);
