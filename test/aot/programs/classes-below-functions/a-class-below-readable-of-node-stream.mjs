// A class of the program extends a constructor function of Bun's own modules: its objects pass through the methods of that function.
import { Readable, Stream } from "node:stream";
import { EventEmitter } from "node:events";
class Numbers extends Readable {
  constructor(limit) { super({ objectMode: true }); this.n = 0; this.limit = limit; }
  _read() { this.push(this.n < this.limit ? { n: this.n++ } : null); }
}
let sum = 0;
const numbers = new Numbers(300);
for await (const item of numbers) sum += item.n;
console.log(sum, numbers.n, numbers.destroyed, numbers.readableEnded, numbers.readableObjectMode);
console.log(numbers instanceof Readable, numbers instanceof Stream, numbers instanceof EventEmitter, numbers instanceof Numbers);
console.log(Object.keys(numbers).join(), Object.getPrototypeOf(Numbers) === Readable, Object.getPrototypeOf(Numbers.prototype) === Readable.prototype);
console.log(new Readable({ read() {} }) instanceof Numbers, numbers.constructor.name, typeof numbers._readableState);
