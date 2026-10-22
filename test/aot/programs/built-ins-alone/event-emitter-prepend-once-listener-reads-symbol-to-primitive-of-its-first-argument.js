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
  first: 1.5,
  second: "two",
  third: item,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive", hint, this === probe);
    return "first";
  },
};
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = subject.prependOnceListener(probe, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._events.first, subject._events.first.length, typeof subject._eventsCount, subject._eventsCount + 1);
console.log(typeof subject._maxListeners, subject._maxListeners === undefined, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
