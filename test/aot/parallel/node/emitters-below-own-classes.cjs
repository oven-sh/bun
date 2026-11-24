// Classes below EventEmitter, and the own emit of an emitter that captures rejections.
const EventEmitter = require("events");
const util = require("util");

class Counter extends EventEmitter {
  constructor(n, options) { super(options); this.n = n; this.i = 0; }
  step() { this.i = (this.i + 1) & 7; return this.i; }
  own() { return this.n; }
}
function Old(n) { EventEmitter.call(this); this.n = n; this.i = 0; }
util.inherits(Old, EventEmitter);
Old.prototype.step = function () { this.i = (this.i + 2) & 7; return this.i; };
Old.prototype.own = function () { return this.n + 1; };

function run(list) {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    const object = list[i % list.length];
    sum += object.step() + object.own();
  }
  return sum;
}
console.log(run([new Counter(1), new Counter(2)]), run([new Old(1), new Old(2)]), run([new Counter(1), new Old(2)]));
const capturing = new Counter(3, { captureRejections: true });
console.log(Object.keys(capturing).join(), Object.keys(new Counter(3)).join(), Object.keys(new Old(3)).join());
console.log(Object.hasOwn(capturing, "emit"), Object.hasOwn(new Counter(1), "emit"), run([capturing, new Counter(2)]));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(capturing, "emit"), (key, value) => (typeof value === "function" ? value.name : value)));

const seen = [];
for (const object of [new Counter(1), new Old(2), capturing]) {
  object.on("step", function (value) { seen.push(value, this === object); });
  object.once("step", value => seen.push("once", value));
  console.log(object.emit("step", 1), object.emit("step", 2), object.emit("nothing"), object.listenerCount("step"));
}
console.log(seen.join());

class Set extends EventEmitter {
  set emit(value) { seen.push("set", typeof value); }
  get emit() { return () => "got"; }
}
console.log(new Set({ captureRejections: true }).emit("x"), Object.hasOwn(new Set({ captureRejections: true }), "emit"), seen.slice(-2).join());
class Fixed extends EventEmitter {}
Object.defineProperty(Fixed.prototype, "emit", { value: () => "fixed", writable: false });
try {
  console.log(new Fixed({ captureRejections: true }).emit("x"));
} catch (error) {
  console.log(error.constructor.name);
}
capturing.on("error", error => console.log("captured", error.message));
capturing.on("fail", async () => { throw new Error("rejected"); });
capturing.emit("fail");
