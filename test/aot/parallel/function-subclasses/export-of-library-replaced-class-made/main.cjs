// The program stores another class under the name that a module of the library exports. A class that extends what it finds there is below that one.
const stream = require("node:stream");
const events = require("node:events");
const original = stream.Readable;
class Fake { constructor() { this.fake = true; } push() { return "fake push"; } }
stream.Readable = Fake;
events.EventEmitter = function Silent() { this.silent = true; };
const { Reader, Bus } = require("./classes.cjs");
const reader = new Reader();
console.log(reader.fake, reader.mine, reader.push(1), reader instanceof Fake, reader instanceof original, Object.keys(reader).join());
const bus = new Bus();
console.log(bus.silent, bus.mine, typeof bus.on, bus instanceof events, Object.keys(bus).join());
stream.Readable = original;
console.log(new Reader() instanceof original, Object.getPrototypeOf(Reader) === Fake);
