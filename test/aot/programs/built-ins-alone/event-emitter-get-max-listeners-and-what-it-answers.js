import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.getMaxListeners();
console.log(typeof result, result + 1);
