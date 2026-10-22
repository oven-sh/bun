import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const result = subject.setMaxListeners(1.5);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._eventsCount, subject._eventsCount + 1, 1 / subject._eventsCount, typeof subject._maxListeners, subject._maxListeners + 1);
