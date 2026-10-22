import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
emitter.on("ready", target);
emitter.emit("ready", numbers);
console.log(numbers.length, typeof numbers[2], numbers[2].length);
