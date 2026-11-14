// A Proxy round a server listens. Which traps are sprung, and that one which throws is heard as in plain. How often `get` and `has` are sprung is not printed.
const http = require("node:http");
const net = require("node:net");
const quiet = new Set(["get", "has", "set", "getOwnPropertyDescriptor", "defineProperty"]);
function run(throws, done) {
  const sprung = new Set();
  const handler = {};
  for (const name of Object.getOwnPropertyNames(Reflect)) {
    handler[name] = function (...all) {
      if (!quiet.has(name)) sprung.add(name);
      if (name === throws) throw new RangeError("made up: " + name);
      return Reflect[name](...all);
    };
  }
  const said = [];
  const inner = http.createServer((req, res) => res.end("x"));
  const server = new Proxy(inner, handler);
  inner.on("error", error => said.push("error " + error.message));
  let isFinished = false;
  const finish = () => {
    if (isFinished) return;
    isFinished = true;
    console.log((throws || "no trap throws") + ": " + said.join(" | ") + " | sprung: " + [...sprung].sort().join());
    inner.close();
    inner.closeAllConnections();
    done();
  };
  try {
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(inner.address().port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
      let text = "";
      client.on("data", bytes => (text += bytes));
      client.on("close", () => {
        said.push("answered " + text.split("\r\n")[0]);
        finish();
      });
    });
  } catch (error) {
    said.push("listen threw " + error.message);
  }
  setTimeout(() => inner.listening || finish(), 150);
}
run("", () => run("getPrototypeOf", () => run("ownKeys", () => {})));
