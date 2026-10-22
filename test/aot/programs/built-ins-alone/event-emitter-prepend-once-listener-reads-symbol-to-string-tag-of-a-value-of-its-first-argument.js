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
const result = subject.prependOnceListener(holder, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._events["first,[object Object],second,[object Object]"], subject._events["first,[object Object],second,[object Object]"].length, typeof subject._eventsCount, subject._eventsCount + 1);
console.log(typeof subject._maxListeners, subject._maxListeners === undefined, Array.isArray(holder), holder.length);
console.log(Array.isArray(holder[0]), holder[0].length, typeof holder[0][0], holder[0][0].length, holder[0][0]);
console.log(typeof holder[0][1], Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
