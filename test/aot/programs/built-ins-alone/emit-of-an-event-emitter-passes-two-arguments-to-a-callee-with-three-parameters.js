import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function target(first, second, third, fourth = "default") {
  console.log(first + 1, second.length);
  console.log(third === undefined, typeof third, fourth.length);
  console.log(arguments.length);
}
emitter.on("ready", target);
emitter.emit("ready", 1.5, "two");
