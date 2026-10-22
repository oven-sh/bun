import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function target(first, second, third, fourth, fifth) {
  console.log(typeof fourth, fourth + 1);
}
emitter.on("ready", target);
emitter.emit("ready", 0, 1, 2, 3.5, 4);
