import { EventEmitter } from "node:events";
const subject = new EventEmitter();
function callback() {
  console.log("callback", arguments.length);
  return "text";
}
const result = subject.removeListener("an", callback);
console.log(result === subject);
