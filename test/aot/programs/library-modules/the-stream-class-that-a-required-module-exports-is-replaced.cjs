const stream = require("node:stream");
const events = require("node:events");
new stream.Duplex(); new stream.Transform();
function make() { return new stream.Readable(); }
function emitter() { return new events.EventEmitter(); }
const say = value => console.log(value.constructor.name, value instanceof events, typeof value._readableState, value.fake);
for (let i = 0; i < 3; i++) { say(make()); say(emitter()); }
const kept = stream.Readable;
stream.Readable = class Fake { fake = 1; };
say(make());
stream.Readable = stream.Writable;
say(make());
Object.defineProperty(stream, "Readable", { get() { console.log("getter"); return kept; }, configurable: true });
say(make());
delete stream.Readable;
try { say(make()); } catch (error) { console.log(error.constructor.name); }
stream.Readable = kept;
say(make());
const keptEmitter = events.EventEmitter;
events.EventEmitter = function Other() { this.fake = 2; };
say(emitter());
events.EventEmitter = keptEmitter;
say(emitter());
