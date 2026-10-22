import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.rawListeners("an");
console.log(Array.isArray(result), result.length);
