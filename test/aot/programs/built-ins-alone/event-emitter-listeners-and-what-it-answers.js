import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.listeners("an");
console.log(Array.isArray(result), result.length);
