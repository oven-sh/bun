// The class that `net.Socket` holds when a server starts to listen is the base of its connections. This one stands in front of every
// method and accessor that a connection inherits, and says when one is used.
const net = require("node:net");
const http = require("node:http");

const Original = net.Socket;
const lines = [];
let isWatching = true;
const say = line => {
  if (isWatching) lines.push(line);
};

class Other extends Original {
  constructor(...list) {
    say("construct " + list.length + " " + typeof list[0]);
    super(...list);
  }
}
for (let level = Original.prototype; level !== Object.prototype; level = Object.getPrototypeOf(level)) {
  for (const key of Reflect.ownKeys(level)) {
    if (Object.hasOwn(Other.prototype, key)) continue;
    const found = Object.getOwnPropertyDescriptor(level, key);
    const name = String(key);
    if (typeof found.value === "function") {
      Object.defineProperty(Other.prototype, key, {
        value(...list) {
          say("call " + name);
          return found.value.apply(this, list);
        },
        writable: true,
        configurable: true,
      });
    } else if (found.get || found.set) {
      Object.defineProperty(Other.prototype, key, {
        get() {
          say("get " + name);
          return found.get?.call(this);
        },
        set(value) {
          say("set " + name);
          found.set?.call(this, value);
        },
        configurable: true,
      });
    }
  }
}

net.Socket = Other;
const server = http.createServer((req, res) => {
  const { socket } = req;
  say(
    [
      "== " + req.method + " " + req.url,
      socket instanceof Original,
      socket instanceof Other,
      Object.getPrototypeOf(Object.getPrototypeOf(socket)) === Other.prototype,
      Object.getPrototypeOf(socket.constructor) === Other,
    ].join(" "),
  );
  if (req.method === "POST") {
    let text = "";
    req.on("data", piece => (text += piece));
    req.on("end", () => res.end(text));
  } else if (req.url === "/write") {
    res.write("a");
    res.end("b");
  } else {
    res.end("ok");
  }
});
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
function ask(port, path, method, body) {
  return new Promise(resolve => {
    const request = http.request({ port, host: "127.0.0.1", path, method, agent }, response => {
      let text = "";
      response.on("data", piece => (text += piece));
      response.on("end", () => setImmediate(() => setImmediate(() => resolve(text))));
    });
    request.end(body);
  });
}
server.listen(0, "127.0.0.1", async () => {
  net.Socket = Original;
  const { port } = server.address();
  for (const [path, method, body] of [
    ["/", "GET"],
    ["/", "GET"],
    ["/write", "GET"],
    ["/", "POST", "sent"],
    ["/", "GET"],
  ]) {
    say("answer " + (await ask(port, path, method, body)));
  }
  isWatching = false;
  agent.destroy();
  server.close(() => console.log(lines.join("\n")));
});
