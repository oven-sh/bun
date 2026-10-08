// What a worker for JavaScript plugins is started with. The program itself is too long for a
// command line: it is the first message. Messages are read from the file descriptor 3.
const { readSync } = require("node:fs");

// Fills `bytes` up to `length`. The process ends when there is no more to read.
function receive(bytes, length) {
  for (let at = 0; at < length; ) {
    const count = readSync(3, bytes, at, length - at, null);
    if (count === 0) process.exit(0);
    at += count;
  }
}

const header = new Uint32Array(2);
receive(new Uint8Array(header.buffer), 8);
const program = Buffer.allocUnsafe(header[0]);
receive(program, header[0]);
const AsyncFunction = (async () => {}).constructor;
await new AsyncFunction("require", "load", "receive", program.toString())(require, specifier => import(specifier), receive);
