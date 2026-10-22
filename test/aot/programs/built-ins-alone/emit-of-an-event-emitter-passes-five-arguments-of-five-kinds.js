import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
  console.log(typeof second, second + 1);
  console.log(typeof third, third.length);
  console.log(typeof fourth, fourth.four);
  console.log(typeof fifth, fifth());
  console.log(arguments.length);
}
emitter.on("ready", target);
emitter.emit("ready", 1, 2.5, "three", { four: 4 }, () => "five");
