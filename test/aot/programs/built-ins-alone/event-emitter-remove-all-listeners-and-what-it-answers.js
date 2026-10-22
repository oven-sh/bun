import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.removeAllListeners("an");
console.log(result === subject);
