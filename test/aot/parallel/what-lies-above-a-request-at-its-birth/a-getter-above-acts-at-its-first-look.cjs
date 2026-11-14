// `_events` is an accessor on IncomingMessage.prototype whose getter acts at its first look at each request. What it finds on the request, and what it lays there, depends on where that look stands among the constructor's stores.
const http = require("node:http");
const net = require("node:net");

const held = new WeakMap();
const looked = new WeakSet();
let act = () => {};
let seen = "";

function lay() {
  Object.defineProperty(http.IncomingMessage.prototype, "_events", {
    configurable: true,
    get() {
      if (!looked.has(this)) {
        looked.add(this);
        act(this);
      }
      return held.get(this);
    },
    set(value) {
      held.set(this, value);
    },
  });
}

const deeds = {
  "says what the request holds by then"(req) {
    seen = ["complete", "url", "method", "socket", "_readableState"].map(name => name + " " + Object.hasOwn(req, name)).join(" . ");
  },
  "stores a url of its own"(req) {
    req.url = "/laid";
  },
  "stores complete"(req) {
    req.complete = "laid";
  },
  "lays a _construct on the request"(req) {
    req._construct = function (callback) {
      seen = "constructed";
      callback();
    };
  },
};

const server = http.createServer((req, res) => {
  res.end(`${req.url} ${req.complete}`);
});

function ask(port) {
  return new Promise(resolve => {
    const client = net.connect(port, "127.0.0.1", () => client.write("GET /asked HTTP/1.1\r\nHost: a\r\n\r\n"));
    client.on("error", () => {});
    client.on("data", chunk => {
      client.destroy();
      resolve(String(chunk).split("\r\n\r\n")[1]);
    });
  });
}

process.on("uncaughtException", error => console.log("uncaught", error.constructor.name));
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  console.log("untouched :", await ask(port));
  lay();
  for (const [label, deed] of Object.entries(deeds)) {
    act = deed;
    seen = "";
    const answer = await ask(port);
    console.log(label, ":", answer, "|", seen);
  }
  delete http.IncomingMessage.prototype._events;
  act = () => {};
  console.log("taken away :", await ask(port));
  process.exit(0);
});
