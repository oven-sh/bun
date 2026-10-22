import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
emitter.on("ready", target);
emitter.emit("ready", 0, 1.5, 2, 3, 4);
