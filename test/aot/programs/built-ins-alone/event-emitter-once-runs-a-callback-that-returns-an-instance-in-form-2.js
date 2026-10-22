class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
import { EventEmitter } from "node:events";
const subject = new EventEmitter();
function callback() {
  console.log("callback", arguments.length);
  return new Item(2.5);
}
const result = subject.once("an", callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._events.an, subject._events.an.length, typeof subject._eventsCount, subject._eventsCount + 1);
console.log(typeof subject._maxListeners, subject._maxListeners === undefined);
