// Readable() asks `this instanceof Readable`: a Symbol.hasInstance of the program's on Readable, Stream or EventEmitter is called at the birth of a request.
const http = require("node:http");
const net = require("node:net");
const { Readable, Stream } = require("node:stream");
const EventEmitter = require("node:events");

const ordinary = Function.prototype[Symbol.hasInstance];
let isAsked = false;

const server = http.createServer((req, res) => res.end("ok"));

function ask(port, more) {
  return new Promise(resolve => {
    const client = net.connect(port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\n" + more + "\r\n"));
    client.on("error", () => {});
    client.on("data", () => (client.destroy(), resolve()));
  });
}

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  await ask(port, "");
  for (const [label, holder] of [
    ["Readable", Readable],
    ["Stream", Stream],
    ["EventEmitter", EventEmitter],
  ]) {
    for (const more of ["", "Connection: close\r\n"]) {
      Object.defineProperty(holder, Symbol.hasInstance, {
        configurable: true,
        value(value) {
          if (this === Readable) isAsked = true;
          return ordinary.call(this, value);
        },
      });
      isAsked = false;
      await ask(port, more);
      delete holder[Symbol.hasInstance];
      console.log(label, more ? "closing" : "kept alive", "asked", isAsked);
    }
  }
  isAsked = false;
  await ask(port, "");
  console.log("taken away asked", isAsked);
  process.exit(0);
});
