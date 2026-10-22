import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
emitter.once("ready", target);
emitter.emit("ready", box);
console.log(typeof box.value, box.value.length);
