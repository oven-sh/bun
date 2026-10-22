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
const probe = {
  count: 0,
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [["first", probe], ["second", item]];
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = subject.on(holder, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(subject._events["first,[object Object],second,[object Object]"] === callback, typeof subject._eventsCount, subject._eventsCount + 1, typeof subject._maxListeners, subject._maxListeners === undefined);
console.log(Array.isArray(holder), holder.length, Array.isArray(holder[0]), holder[0].length);
console.log(typeof holder[0][0], holder[0][0].length, holder[0][0], typeof holder[0][1]);
console.log(Array.isArray(holder[1]), holder[1].length, typeof holder[1][0], holder[1][0].length, holder[1][0]);
console.log(holder[1][1].double());
console.log(calls, probe.count);
