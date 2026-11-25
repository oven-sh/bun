// Inside `with` a free name may be a member of the object: the front end treats `Proxy` there as a name that is looked for at run time.
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
function make(target) {
  with (handler) {
    return new Proxy(target, handler);
  }
}
Object.setPrototypeOf(EventEmitter.prototype, make({}));
process.on("warning", warning => console.log("heard", warning.name));
process.emitWarning("old", "DeprecationWarning");
console.log("done");
