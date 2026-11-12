// The template does not fold: one of its values is unknown. Its first part is the whole name, written with an escape.
const EventEmitter = require("node:events");
const unseen = x => [x][JSON.parse("0")];
Object.defineProperty(EventEmitter.prototype, `no\x44eprecation${unseen("")}`, {
  get() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  },
  configurable: true,
});
process.emitWarning("old", "DeprecationWarning");
console.log("done");
