// Which function of the library a class extends is known only when the class is made.
import { Readable, Writable, Duplex } from "node:stream";
import { EventEmitter } from "node:events";
function below(Base, name) {
  return { [name]: class extends Base { constructor(options) { super(options); this.mark = name; } } }[name];
}
const bases = [Readable, Writable, Duplex, EventEmitter, Object, function Own() { this.own = 1; }];
for (const Base of bases) {
  const Made = below(Base, "Below" + Base.name);
  const made = new Made();
  console.log(Made.name, made.mark, made instanceof Base, made instanceof EventEmitter, Object.keys(made).includes("mark"), made.own);
}
const flag = process.argv.length > 100;
class Either extends (flag ? Readable : Writable) { constructor() { super(); this.side = flag; } }
const either = new Either();
console.log(either instanceof Writable, either instanceof Readable, either.side, typeof either.write, typeof either.read);
let Chosen = Readable;
Chosen = Writable;
class Late extends Chosen {}
console.log(new Late() instanceof Writable, new Late() instanceof Readable);
