let calls = 0;
import { EventEmitter } from "node:events";
class Special extends EventEmitter {
  count = 0;
  on(firstValue, secondValue, thirdValue) {
    calls++;
    this.count++;
    console.log("on", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super.on(...arguments);
  }
}
const special = new Special();
function callback() {
  console.log("callback", arguments.length);
  return true;
}
console.log("made");
const result = special.once(1.5, callback);
console.log(result === special, typeof special, Object.keys(special).join(), typeof special._events, Object.keys(special._events).join());
console.log(typeof special._events["1.5"], special._events["1.5"].length, typeof special._eventsCount, special._eventsCount + 1);
console.log(typeof special._maxListeners, special._maxListeners === undefined, typeof special.count, special.count + 1);
console.log(calls, special.count);
