// `extra` is an accessor of the class below and a plain property that the program adds to an object of the class above: the two never meet on one object, and nobody promised that they do not lie there.
// Under: --aot-testing=CheckWalkAtRunTime: the net on the yes of $isPlainHeirOf, as it was first written, asked the prototype of the class below for every field of the class above, and stopped a right program
import { Readable } from "node:stream";
class Heir extends Readable {
  _read() {}
  get extra() {
    return 7;
  }
}
class Lower extends Heir {}
const made = [new Heir(), new Lower()];
const ask = () => made.map(stream => `${stream.destroyed} ${stream.closed} ${stream.readable} ${stream.extra}`).join(" | ");
console.log("in front:", ask());
const grown = new Readable({ read() {} });
grown.extra = 1;
Object.getOwnPropertyNames(Heir.prototype);
Heir.prototype.touched = 1;
delete Heir.prototype.touched;
console.log("behind:", ask(), "|", grown.extra, grown.destroyed);
