// `_events` is a getter on IncomingMessage.prototype, with a setter and without: the listeners that it hands out are heard.
const http = require("node:http");
const net = require("node:net");

const heard = new Set();
const made = new WeakMap();

function lay(hasSetter) {
  Object.defineProperty(http.IncomingMessage.prototype, "_events", {
    configurable: true,
    get() {
      let events = made.get(this);
      if (events === undefined) {
        events = { __proto__: null, close: () => heard.add("close"), end: () => heard.add("end") };
        made.set(this, events);
      }
      return events;
    },
    ...(hasSetter && {
      set(value) {
        made.set(this, value);
      },
    }),
  });
}

process.on("uncaughtException", error => {
  console.log("uncaught", error.constructor.name);
  process.exit(0);
});

const server = http.createServer((req, res) => {
  req.resume();
  res.end("ok");
});

function ask(port) {
  return new Promise(resolve => {
    const client = net.connect(port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n"));
    client.on("data", () => setTimeout(() => (client.destroy(), resolve()), 30));
  });
}

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  await ask(port);
  console.log("untouched", [...heard].sort().join());
  for (const hasSetter of [false, true]) {
    lay(hasSetter);
    heard.clear();
    await ask(port);
    console.log(hasSetter ? "with a setter" : "without a setter", [...heard].sort().join());
  }
  delete http.IncomingMessage.prototype._events;
  heard.clear();
  await ask(port);
  console.log("taken away", [...heard].sort().join());
  process.exit(0);
});
