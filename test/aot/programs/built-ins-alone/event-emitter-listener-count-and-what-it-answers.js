import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.listenerCount("an");
console.log(typeof result, result + 1, 1 / result);
