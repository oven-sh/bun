// A proxy above EventEmitter.prototype answers every name that `process` lacks, and the program spells none of them. The receiver is `process`.
const EventEmitter = require("node:events");
let asked = 0;
Object.setPrototypeOf(
  EventEmitter.prototype,
  new Proxy(
    {},
    {
      get(target, key, receiver) {
        if (!asked++) console.log("asked", receiver === process, typeof receiver.allowedNodeEnvironmentFlags.has);
        return Reflect.get(target, key, receiver);
      },
      has() {
        return true;
      },
    },
  ),
);
process.on("warning", warning => console.log("heard", warning.name));
process.emitWarning("old", "DeprecationWarning");
console.log("done");
