import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.eventNames();
console.log(Array.isArray(result), result.length);
