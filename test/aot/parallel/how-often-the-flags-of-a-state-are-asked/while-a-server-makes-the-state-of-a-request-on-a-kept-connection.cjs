const http = require("node:http");
const net = require("node:net");
const { Readable } = require("node:stream");

const first = new Readable({ read() {} })._readableState;
const flags = Object.getOwnPropertySymbols(first).find(symbol => typeof first[symbol] === "number");
const older = new WeakSet();
let armed = false;
let log = [];
for (const key of [flags, "highWaterMark", "buffer", "bufferIndex", "length", "pipes", "awaitDrainWriters"]) {
  const held = new WeakMap();
  const name = typeof key === "symbol" ? "flags" : key;
  Object.defineProperty(Object.getPrototypeOf(first), key, {
    configurable: true,
    get() {
      if (!armed) older.add(this);
      else if (!older.has(this)) log.push(name);
      return held.get(this);
    },
    set(value) {
      if (!armed) older.add(this);
      else if (!older.has(this)) log.push(name + " = " + (typeof value === "object" ? JSON.stringify(value) : value));
      held.set(this, value);
    },
  });
}

let seen;
const server = http.createServer((request, response) => {
  seen = log.join(" | ");
  armed = false;
  response.end("x");
});
server.listen(0, "127.0.0.1", () => {
  const socket = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  socket.on("data", () => {
    if (answers++) return;
    setTimeout(() => {
      log = [];
      armed = true;
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      setTimeout(() => {
        console.log(seen);
        process.exit(0);
      }, 60);
    }, 30);
  });
  socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
