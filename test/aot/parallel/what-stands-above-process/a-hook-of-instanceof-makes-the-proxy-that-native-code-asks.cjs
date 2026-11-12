const EventEmitter = require("node:events");
let asked = 0;
const handler = {
  get(target, key, receiver) {
    if (!asked++) console.log("asked", receiver === process, typeof receiver.allowedNodeEnvironmentFlags.has);
    return Reflect.get(target, key, receiver);
  },
  has() {
    return true;
  },
};
class Taker {
  static [Symbol.hasInstance](Made) {
    Object.setPrototypeOf(EventEmitter.prototype, new Made({}, handler));
    return false;
  }
}
console.log("is", Proxy instanceof Taker);
process.on("warning", warning => console.log("heard", warning.name));
process.emitWarning("old", "DeprecationWarning");
console.log("done");
