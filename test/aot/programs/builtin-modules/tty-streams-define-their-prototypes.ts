// node:tty replaces the `prototype` of its two constructor functions by accessors that fill in the real one at the first read. Express loads it through `debug`.
import tty from "node:tty";
console.log(typeof tty.WriteStream, typeof tty.ReadStream, typeof tty.isatty);
console.log(typeof tty.WriteStream.prototype.clearLine, typeof tty.ReadStream.prototype.setRawMode);
console.log(Object.getOwnPropertyDescriptor(tty.WriteStream, "prototype")!.configurable, tty.isatty(-1));
