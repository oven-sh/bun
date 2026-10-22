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
const result = subject.prependOnceListener(1.5, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._events["1.5"], subject._events["1.5"].length, typeof subject._eventsCount, subject._eventsCount + 1);
console.log(typeof subject._maxListeners, subject._maxListeners === undefined);
