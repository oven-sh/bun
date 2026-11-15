// Every row answers one request with a content-length and prints the head that went over the wire.
import http from "node:http";
import net from "node:net";

process.removeAllListeners("warning");
process.on("warning", warning => console.log("   warning: " + warning.name));
const body = "hello";
const keepAliveSymbolOf = req => Object.getOwnPropertySymbols(req).find(symbol => String(symbol).includes("ShouldKeepAlive"));
function underTheRequestsSymbol(req, act) {
  const symbol = keepAliveSymbolOf(req);
  if (symbol === undefined) return console.log("   no such symbol on the request");
  const held = req[symbol];
  let reads = 0;
  Object.defineProperty(req, symbol, { configurable: true, get() { if (reads++ === 0) act(); return held; }, set() {} });
}
const rows = {
  "as it is": () => {},
  "sendDate is false": (req, res) => { res.sendDate = false; },
  "sendDate is 1": (req, res) => { res.sendDate = 1; },
  "a date of the program's": (req, res) => { res.setHeader("Date", "then"); },
  "connection: close": (req, res) => { res.setHeader("Connection", "close"); },
  "connection: keep-alive": (req, res) => { res.setHeader("Connection", "keep-alive"); },
  "keep-alive of the program's": (req, res) => { res.setHeader("Keep-Alive", "timeout=77"); },
  "connection removed": (req, res) => { res.removeHeader("Connection"); },
  "connection removed, no keep-alive": (req, res) => { res.removeHeader("Connection"); res.shouldKeepAlive = false; },
  "shouldKeepAlive stored false": (req, res) => { res.shouldKeepAlive = false; },
  "an own shouldKeepAlive": (req, res) => { Object.defineProperty(res, "shouldKeepAlive", { value: false, configurable: true }); },
  "an own accessor shouldKeepAlive": (req, res) => { Object.defineProperty(res, "shouldKeepAlive", { get() { console.log("   shouldKeepAlive is read"); return false; }, configurable: true }); },
  "status 204": (req, res) => { res.statusCode = 204; },
  "status 304": (req, res) => { res.statusCode = 304; },
  "a value with toString": (req, res) => { res.setHeader("X-Made", { toString() { console.log("   toString runs"); return "made"; } }); },
  "a value whose toString stores": (req, res) => { res.setHeader("X-Made", { toString() { res.sendDate = false; return "made"; } }); },
  "a list of values": (req, res) => { res.setHeader("X-Many", ["a", "b"]); },
  "transfer-encoding beside it": (req, res) => { res.setHeader("Transfer-Encoding", "chunked"); },
  "_keepAliveTimeout stored": (req, res) => { res._keepAliveTimeout = 9000; },
  "_keepAliveTimeout a string": (req, res) => { res._keepAliveTimeout = "9000"; },
  "_keepAliveTimeout 0": (req, res) => { res._keepAliveTimeout = 0; },
  "_maxRequestsPerSocket 3": (req, res) => { res._maxRequestsPerSocket = 3; },
  "_maxRequestsPerSocket null": (req, res) => { res._maxRequestsPerSocket = null; },
  "maxRequestsOnConnectionReached": (req, res) => { res.maxRequestsOnConnectionReached = true; },
  "_hasBody false": (req, res) => { res._hasBody = false; },
  "no request": (req, res) => { res.req = null; },
  "an accessor on sendDate": (req, res) => { Object.defineProperty(res, "sendDate", { get() { console.log("   sendDate is read"); return false; }, configurable: true }); },
  "an accessor on _hasBody": (req, res) => { Object.defineProperty(res, "_hasBody", { get() { console.log("   _hasBody is read"); return true; }, set() {}, configurable: true }); },
  "the request's answer stored false": (req, res) => { req[keepAliveSymbolOf(req)] = false; },
  "the request's answer stored undefined": (req, res) => { req[keepAliveSymbolOf(req)] = undefined; },
  "read of the request's answer stores sendDate": (req, res) => underTheRequestsSymbol(req, () => { res.sendDate = false; }),
  "read of the request's answer stores _hasBody": (req, res) => underTheRequestsSymbol(req, () => { res._hasBody = false; }),
  "read of the request's answer stores _keepAliveTimeout": (req, res) => underTheRequestsSymbol(req, () => { res._keepAliveTimeout = 9000; }),
  "read of the request's answer stores _maxRequestsPerSocket": (req, res) => underTheRequestsSymbol(req, () => { res._maxRequestsPerSocket = 4; }),
  "read of the request's answer lays an accessor on _hasBody": (req, res) => underTheRequestsSymbol(req, () => { Object.defineProperty(res, "_hasBody", { get() { return false; }, set() {}, configurable: true }); }),
  "read of the request's answer sets a header": (req, res) => underTheRequestsSymbol(req, () => { try { res.setHeader("X-Late", "late"); } catch (error) { console.log("   " + error.code); } }),
  "a heir of the response": (req, res) => Object.create(res),
  "a proxy of the response": (req, res) => new Proxy(res, {}),
};
const servers = {
  "the server as it is": () => {},
  "keepAliveTimeout 0": server => { server.keepAliveTimeout = 0; },
  "keepAliveTimeout -1": server => { server.keepAliveTimeout = -1; },
  "keepAliveTimeout 1e15": server => { server.keepAliveTimeout = 1e15; },
  "keepAliveTimeout 1500": server => { server.keepAliveTimeout = 1500; },
  "keepAliveTimeout 999": server => { server.keepAliveTimeout = 999; },
  "maxRequestsPerSocket 2": server => { server.maxRequestsPerSocket = 2; },
};
const requests = {
  "GET": "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
  "HEAD": "HEAD / HTTP/1.1\r\nHost: a\r\n\r\n",
  "GET, close": "GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n",
  "GET 1.0": "GET / HTTP/1.0\r\nHost: a\r\n\r\n",
  "GET 1.0, keep-alive": "GET / HTTP/1.0\r\nHost: a\r\nConnection: keep-alive\r\n\r\n",
};

let act = () => {};
const server = http.createServer((req, res) => {
  let answers = res;
  try {
    answers = act(req, res) ?? res;
    answers.setHeader("Content-Length", body.length);
    answers.end(body);
  } catch (error) {
    console.log("   throws " + error.name + ": " + error.message);
    res.destroy();
  }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const port = server.address().port;

function ask(text, times = 1) {
  return new Promise(done => {
    const socket = net.connect(port, "127.0.0.1");
    let got = "", asked = 1;
    const finish = () => { clearTimeout(timer); socket.destroy(); done(got); };
    const timer = setTimeout(finish, 400);
    socket.on("data", chunk => {
      got += chunk.toString("latin1");
      if (asked < times && got.split("HTTP/1.1 ").length - 1 === asked) { asked++; socket.write(text); }
    });
    socket.on("close", finish);
    socket.on("error", finish);
    socket.write(text);
  });
}
const shown = text => text.replace(/Date: [A-Z][^\r]*GMT/g, "Date: <now>").replace(/\r\n/g, " | ");

for (const name in rows) {
  act = rows[name];
  console.log(name + ": " + shown(await ask(requests.GET)));
}
act = () => {};
for (const name in requests) console.log(name + ": " + shown(await ask(requests[name])));
for (const name in servers) {
  servers[name](server);
  console.log(name + ": " + shown(await ask(requests.GET, 3)));
  console.log(name + ", again: " + shown(await ask(requests.GET)));
}
server.close();
server.closeAllConnections();
