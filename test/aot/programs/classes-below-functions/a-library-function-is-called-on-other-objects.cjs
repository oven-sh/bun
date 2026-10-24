// `EventEmitter.call(x)` and `Readable.call(x)` with receivers that no class of theirs has made.
const EventEmitter = require("node:events");
const { Readable } = require("node:stream");
class Bus extends EventEmitter { constructor() { super(); this.tag = "bus"; } }
class Plain { constructor() { this.tag = "plain"; } }
const literal = { tag: "literal" };
EventEmitter.call(literal);
console.log(Object.keys(literal).join(), typeof literal.on);
const plain = new Plain();
EventEmitter.call(plain);
console.log(Object.keys(plain).join(), plain instanceof EventEmitter);
Object.setPrototypeOf(plain, EventEmitter.prototype);
plain.on("x", function () { console.log("heard by", this.tag); });
plain.emit("x");
const bus = new Bus();
bus.on("x", () => console.log("bus"));
EventEmitter.call(bus);
console.log(bus.listenerCount("x"), bus.emit("x"));
const made = Object.create(Readable.prototype);
Readable.call(made, { read() { this.push(null); } });
made.on("end", () => console.log("ended", made instanceof Readable, Object.keys(made).length > 2));
made.resume();
const returned = Readable.call(literal);
console.log(returned instanceof Readable, literal instanceof Readable, "_readableState" in literal);
for (const receiver of [undefined, null, 1, "s"]) {
  try { console.log(typeof EventEmitter.call(receiver)); } catch (error) { console.log(error.constructor.name); }
}
