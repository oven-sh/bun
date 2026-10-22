let calls = 0;
import { EventEmitter } from "node:events";
class Special extends EventEmitter {
  count = 0;
  prependListener(firstValue, secondValue, thirdValue) {
    calls++;
    this.count++;
    console.log("prependListener", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super.prependListener(...arguments);
  }
}
const special = new Special();
function callback() {
  console.log("callback", arguments.length);
  return true;
}
console.log("made");
const result = special.prependOnceListener("an", callback);
console.log(result === special, typeof special, Object.keys(special).join(), typeof special._events, Object.keys(special._events).join());
console.log(typeof special._events.an, special._events.an.length, typeof special._eventsCount, special._eventsCount + 1);
console.log(typeof special._maxListeners, special._maxListeners === undefined, typeof special.count, special.count + 1);
console.log(calls, special.count);
