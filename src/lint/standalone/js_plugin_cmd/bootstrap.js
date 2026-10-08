// What a process for JavaScript plugins is started with: see `processes.rs`. Messages are read from the file descriptor 3 and
// written to 4. The program itself is too long for a command line: it is the first message.
const { readSync, writeSync } = require("node:fs");

const PROGRAM = 100;
const RESULT = 100;

// Fills `bytes` up to `length`. The process ends when there is no more to read.
function receive(bytes, length) {
  for (let at = 0; at < length; ) {
    const count = readSync(3, bytes, at, length - at, null);
    if (count === 0) process.exit(0);
    at += count;
  }
}

const header = new Uint32Array(2);
const headerBytes = new Uint8Array(header.buffer);

function send(kind, text) {
  const bytes = Buffer.from(text);
  const message = Buffer.allocUnsafe(8 + bytes.length);
  message.writeUInt32LE(bytes.length, 0);
  message.writeUInt32LE(kind, 4);
  message.set(bytes, 8);
  for (let at = 0; at < message.length; ) at += writeSync(4, message, at);
}

// The content of the message that is being handled.
let message = new Uint8Array(0);
// Whether that is what does not fit into the buffer it was asked for with.
let isMessagePending = false;

function request(kind, details, buffer) {
  isMessagePending = kind === 0;
  if (!isMessagePending) {
    send(kind, details);
    receive(headerBytes, 8);
  }
  const length = isMessagePending ? message.length : header[0];
  if (length <= buffer.byteLength) again(buffer);
  return length;
}

function again(buffer) {
  if (isMessagePending) new Uint8Array(buffer).set(message);
  else receive(new Uint8Array(buffer), header[0]);
}

receive(headerBytes, 8);
if (header[1] !== PROGRAM) throw new Error("The first message is not the program.");
const program = Buffer.allocUnsafe(header[0]);
receive(program, header[0]);
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const handle = new Function("require", "load", "request", "again", "decode", program.toString())(
  require,
  specifier => import(specifier),
  request,
  again,
  (buffer, start, end) => decoder.decode(new Uint8Array(buffer, start, end - start)),
);
for (;;) {
  receive(headerBytes, 8);
  const kind = header[1];
  message = new Uint8Array(header[0]);
  receive(message, header[0]);
  send(RESULT, await handle(kind));
}
