// After its definition the class is hung below another function of the library, below a class of the program, and below nothing.
import { Readable, Writable } from "node:stream";
class Pipe extends Readable { constructor(options) { super(options); this.mine = 1; } }
const before = new Pipe();
Object.setPrototypeOf(Pipe, Writable);
Object.setPrototypeOf(Pipe.prototype, Writable.prototype);
const after = new Pipe();
console.log(before instanceof Writable, "_readableState" in before, "_writableState" in before, typeof before.read, typeof before.write);
console.log(after instanceof Writable, after instanceof Readable, "_readableState" in after, "_writableState" in after, after.mine);
class Own { constructor() { this.own = 2; } }
Object.setPrototypeOf(Pipe, Own);
const third = new Pipe();
console.log(Object.keys(third).join(), third instanceof Own, third instanceof Writable);
Object.setPrototypeOf(Pipe, Function.prototype);
try { new Pipe(); } catch (error) { console.log(error.constructor.name); }
Object.setPrototypeOf(Pipe, null);
try { new Pipe(); } catch (error) { console.log(error.constructor.name); }
