let calls = 0;
import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 1.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "1.5";
  },
};
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = subject.once(probe, callback);
console.log(result === subject, typeof subject, Object.keys(subject).join(), typeof subject._events, Object.keys(subject._events).join());
console.log(typeof subject._events["1.5"], subject._events["1.5"].length, typeof subject._eventsCount, subject._eventsCount + 1);
console.log(typeof subject._maxListeners, subject._maxListeners === undefined, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
