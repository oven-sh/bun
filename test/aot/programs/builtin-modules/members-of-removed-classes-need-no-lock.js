// node:repl calls `.start(`, `.write(` and `.end(` on values of unknown type, and a lookup by name takes the methods of Bun.ArrayBufferSink for constants, among others. Nothing here makes a stream, so the class is not in the executable, and start-up has no prototype of it to lock.
import "node:repl";
console.log(1);
