const http = require("node:http");
const util = require("node:util");
const { EventEmitter } = require("node:events");
function Message(own) {
  http.OutgoingMessage.call(this);
  this.own = own - own;
}
util.inherits(Message, http.OutgoingMessage);
function Emitter(own) {
  EventEmitter.call(this);
  this.own = own - own;
}
util.inherits(Emitter, EventEmitter);
class Listener extends EventEmitter {
  constructor(own) {
    super();
    this.own = own - own;
  }
}
if (globalThis.kept.length) {
  const stored = globalThis.stored;
  for (const [made, name] of [[Message, "_hasBody"], [Message, "outputSize"], [Emitter, "_eventsCount"], [Emitter, "_maxListeners"], [Listener, "_eventsCount"], [Listener, "_maxListeners"]])
    Object.defineProperty(made.prototype, name, { get: () => "taken", set: value => stored.push(`${made.name}.${name}:${typeof value}`), configurable: true });
}
module.exports = { Message, Emitter, Listener };
globalThis.kept.push(module.exports);
if (globalThis.kept.length < 2) throw new Error("not yet: " + globalThis.kept.length);
