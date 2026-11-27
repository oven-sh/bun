// A member of a prototype of the library holds no cell; the program lays another value that is no cell in its place, and then a request is served.
const http = require("node:http");
http.IncomingMessage.prototype.httpVersionMajor = JSON.parse(process.argv[2] ?? "0");
const seen = [];
const server = http.createServer((req, res) => { seen.push(req.method, req.httpVersion, req.httpVersionMajor, req.httpVersionMinor, req.statusCode, req.upgrade, req.headers["x-two"], res.statusCode, res.listenerCount("close") >= 0); res.end("x"); });
server.listen(0, () => http.get({ port: server.address().port, agent: new http.Agent({ keepAlive: true }), headers: { "x-two": ["a", "b"] } }, r => {
  let length = 0; r.on("data", chunk => length += chunk.length);
  r.on("end", () => { console.log(JSON.stringify([seen, r.statusCode, r.httpVersion, r.headers.connection, r.headers["content-length"], r.headers["transfer-encoding"], length])); process.exit(0); }); }));
