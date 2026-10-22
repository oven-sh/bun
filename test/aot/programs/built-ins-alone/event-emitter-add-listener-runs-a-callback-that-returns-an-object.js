import { EventEmitter } from "node:events";
const subject = new EventEmitter();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.addListener(1.5, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(subject._events["1.5"] === callback, typeof subject._eventsCount, subject._eventsCount + 1, typeof subject._maxListeners, subject._maxListeners === undefined);
