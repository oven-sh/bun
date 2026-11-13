const http = require("node:http");
const util = require("node:util");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
function Message(own) {
  http.OutgoingMessage.call(this);
  this.own = own - own;
}
util.inherits(Message, http.OutgoingMessage);
function Source(own) {
  Readable.call(this, { read() {} });
  this.own = own - own;
}
Object.setPrototypeOf(Source.prototype, Readable.prototype);
function Emitter(own) {
  EventEmitter.call(this);
  this.own = own - own;
}
Emitter.prototype = Object.create(EventEmitter.prototype, { constructor: { value: Emitter, writable: true, configurable: true } });
class Listener extends EventEmitter {
  constructor(own) {
    super();
    this.own = own - own;
  }
}
module.exports = { Message, Source, Emitter, Listener };
globalThis.kept.push(module.exports);
if (globalThis.kept.length < 3) throw new Error("not yet: " + globalThis.kept.length);
