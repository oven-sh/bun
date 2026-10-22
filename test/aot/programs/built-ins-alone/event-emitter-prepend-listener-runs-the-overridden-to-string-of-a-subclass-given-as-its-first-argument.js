let calls = 0;
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
class Special extends Array {
  count = 0;
  toString(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("toString", arguments.length, typeof firstValue, typeof secondValue);
    return super.toString(...arguments);
  }
}
const special = new Special(1.5, item, "two");
function callback() {
  console.log("callback", arguments.length);
  return true;
}
console.log("made");
const result = subject.prependListener(special, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(subject._events["1.5,[object Object],two"] === callback, typeof subject._eventsCount, subject._eventsCount + 1, typeof subject._maxListeners, subject._maxListeners === undefined);
console.log(Array.isArray(special), special.length, typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
