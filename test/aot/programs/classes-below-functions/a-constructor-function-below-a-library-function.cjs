// The old way: a function of the program calls a function of the library on its `this` and links the prototype objects.
const util = require("node:util");
const EventEmitter = require("node:events");
const { Readable, Writable } = require("node:stream");
function Bus(name) { EventEmitter.call(this); this.name = name; this.count = 0; }
util.inherits(Bus, EventEmitter);
Bus.prototype.send = function (n) { this.count++; return this.emit("n", n); };
function Counter(limit) { Readable.call(this, { objectMode: true }); this.next = 0; this.limit = limit; }
Object.setPrototypeOf(Counter.prototype, Readable.prototype);
Object.setPrototypeOf(Counter, Readable);
Counter.prototype._read = function () { this.push(this.next < this.limit ? this.next++ : null); };
function Sink() { if (!(this instanceof Sink)) return new Sink(); Writable.call(this, { objectMode: true }); this.sum = 0; }
Sink.prototype = Object.create(Writable.prototype, { constructor: { value: Sink, writable: true, configurable: true } });
Sink.prototype._write = function (chunk, encoding, done) { this.sum += chunk; done(); };
class Loud extends Bus { constructor() { super("loud"); this.volume = 11; } }
const bus = new Bus("b"), loud = new Loud();
let total = 0;
for (const each of [bus, loud]) each.on("n", n => { total += n; });
for (let i = 0; i < 200; i++) { bus.send(i); loud.send(1); }
console.log(total, bus.count, loud.count, loud.volume, Object.keys(loud).join(), loud instanceof EventEmitter, Bus.super_ === EventEmitter);
const sink = Sink();
new Counter(100).pipe(sink).on("finish", () => console.log(sink.sum, sink instanceof Writable, sink.constructor === Sink, Object.keys(sink).includes("sum")));
