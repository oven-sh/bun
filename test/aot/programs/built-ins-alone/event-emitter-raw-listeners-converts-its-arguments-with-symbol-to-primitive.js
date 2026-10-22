let calls = 0;
import { EventEmitter } from "node:events";
const subject = new EventEmitter();
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.rawListeners(probe);
console.log(Array.isArray(result), result.length, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
