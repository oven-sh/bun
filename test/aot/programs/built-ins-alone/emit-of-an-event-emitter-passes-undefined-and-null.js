import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function target(first, second, third, fourth, fifth) {
  console.log(first === undefined, typeof first);
  console.log(second === null, typeof second);
  console.log(third + 1, arguments.length);
}
emitter.on("ready", target);
emitter.emit("ready", undefined, null, 0.5);
