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
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive", hint, this === probe);
    return "first";
  },
};
const holder = [probe, ["second", item]];
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = subject.addListener(holder, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(subject._events["first,second,[object Object]"] === callback, typeof subject._eventsCount, subject._eventsCount + 1, typeof subject._maxListeners, subject._maxListeners === undefined);
console.log(Array.isArray(holder), holder.length, typeof holder[0], Object.keys(holder[0]).join());
console.log(typeof holder[0].count, holder[0].count + 1, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
