// `this` of a sloppy function that is called plainly is the global object: `this.Proxy` is Proxy, and no free name spells it.
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
  return new this.Proxy(target, handler);
}
Object.setPrototypeOf(EventEmitter.prototype, make({}));
process.on("warning", warning => console.log("heard", warning.name));
process.emitWarning("old", "DeprecationWarning");
console.log("done");
