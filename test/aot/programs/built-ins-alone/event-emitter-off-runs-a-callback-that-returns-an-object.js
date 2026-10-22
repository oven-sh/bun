import { EventEmitter } from "node:events";
const subject = new EventEmitter();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.off("an", callback);
console.log(result === subject);
