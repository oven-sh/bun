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
  get [Symbol.toPrimitive]() {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
function callback() {
  console.log("callback", arguments.length);
  return true;
}
console.log("made");
const result = subject.prependOnceListener(special, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._events["1.5,[object Object],two"], subject._events["1.5,[object Object],two"].length, typeof subject._eventsCount, subject._eventsCount + 1);
console.log(typeof subject._maxListeners, subject._maxListeners === undefined, Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
