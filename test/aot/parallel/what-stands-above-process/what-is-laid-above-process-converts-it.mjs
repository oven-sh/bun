// The language looks on an object for what makes a text, a number or a key of it, and finds what the program has laid above `process`.
import { EventEmitter } from "node:events";
const kept = [];
EventEmitter.prototype[Symbol.toPrimitive] = function (hint) {
  kept.push(this);
  return hint === "number" ? 7 : "seven";
};
console.log(`${process}`, +process, process + "", process == "seven", process < 8, Object.keys({ [process]: 1 })[0]);
console.log(kept.length);
const held = kept[0];
console.log("same", held === process);
console.log("output", held.stdout instanceof EventEmitter, typeof held.stdout.cork);
console.log("input", typeof held.stdin.isPaused());
