// An accessor on IncomingMessage.prototype, or on a class above, takes the store that the constructor makes under its name: the request gets no property of its own.
const http = require("node:http");
const net = require("node:net");
const { Readable, Stream } = require("node:stream");
const EventEmitter = require("node:events");

const names = [
  "_consuming",
  "_dumped",
  "complete",
  "_closed",
  "rawTrailers",
  "url",
  "method",
  "socket",
  "client",
  "upgrade",
  "_events",
  "_readableState",
  "_maxListeners",
];
const holders = [
  ["IncomingMessage", http.IncomingMessage.prototype],
  ["Readable", Readable.prototype],
  ["Stream", Stream.prototype],
  ["EventEmitter", EventEmitter.prototype],
];

let seen = "";
const server = http.createServer((req, res) => {
  seen = look(req);
  res.end("ok");
});
let look = () => "";

function ask(port) {
  return new Promise(resolve => {
    const client = net.connect(port, "127.0.0.1", () => client.write("GET /path HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
    let text = "";
    client.on("data", chunk => (text += chunk));
    client.on("error", () => {});
    client.on("close", () => {
      resolve(text.slice(0, 12));
    });
  });
}

function askKeptAlive(port) {
  return new Promise(resolve => {
    const client = net.connect(port, "127.0.0.1", () => client.write("GET /path HTTP/1.1\r\nHost: a\r\n\r\n"));
    client.on("error", () => {});
    client.on("data", chunk => {
      client.destroy();
      resolve(String(chunk).slice(0, 12));
    });
  });
}

process.on("uncaughtException", error => {
  console.log("uncaught", error.constructor.name);
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  await askKeptAlive(port);
  for (const [label, holder] of holders) {
    for (const name of names) {
      for (const way of [askKeptAlive, ask]) {
        const before = Object.getOwnPropertyDescriptor(holder, name);
        const held = new WeakMap();
        let isStored = false;
        Object.defineProperty(holder, name, {
          configurable: true,
          get() {
            return held.has(this) ? held.get(this) : before && "value" in before ? before.value : undefined;
          },
          set(value) {
            if (this instanceof http.IncomingMessage) isStored = true;
            held.set(this, value);
          },
        });
        look = req => `own ${Object.hasOwn(req, name)} type ${typeof req[name]}`;
        seen = "no request";
        const answer = await way(port);
        if (before) Object.defineProperty(holder, name, before);
        else delete holder[name];
        console.log(label, name, way.name, "|", seen, "| stored", isStored, "|", answer);
      }
    }
  }
  look = () => "";
  console.log("behind them all", await askKeptAlive(port));
  process.exit(0);
});
