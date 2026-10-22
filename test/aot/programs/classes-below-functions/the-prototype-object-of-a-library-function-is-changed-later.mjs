// The methods that a class inherits from a function of the library are replaced after objects of the class exist.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Bus extends EventEmitter { constructor() { super(); this.sent = 0; } send(n) { this.sent++; return this.emit("n", n); } }
class Letters extends Readable { constructor() { super(); this.left = 3; } _read() { this.push(this.left-- > 0 ? "x" : null); } }
const bus = new Bus();
let heard = 0;
bus.on("n", n => { heard += n; });
for (let i = 0; i < 100; i++) bus.send(1);
const emit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (name, ...rest) { if (name === "n") heard += 1000; return emit.call(this, name, ...rest); };
for (let i = 0; i < 3; i++) bus.send(1);
console.log(heard, bus.sent);
EventEmitter.prototype.emit = emit;
bus.send(1);
console.log(heard, bus.sent);
const push = Readable.prototype.push;
let pushed = 0;
Readable.prototype.push = function (chunk, encoding) { pushed++; return push.call(this, chunk, encoding); };
let text = "";
for await (const chunk of new Letters()) text += chunk;
console.log(text, pushed);
Readable.prototype.extra = function () { return this.left; };
console.log(new Letters().extra());
Object.defineProperty(EventEmitter.prototype, "sent", { get() { return "inherited"; }, set(value) { console.log("set", value); }, configurable: true });
console.log(new Bus().sent, bus.sent);
delete EventEmitter.prototype.sent;
console.log(new Bus().sent);
