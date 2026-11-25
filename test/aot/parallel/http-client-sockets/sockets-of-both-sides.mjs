// The sockets that requests, responses and agents hold, on both sides of a connection.
import http from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";

const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const lines = [];
const kinds = o => (o === null ? "null" : o === undefined ? "undefined" : o.constructor.name + (o instanceof net.Socket ? " net" : o instanceof Duplex ? " duplex" : ""));
let port = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/kinds") {
    res.end([kinds(req.socket), kinds(req.connection), kinds(res.socket), kinds(res.connection), req.socket === res.socket, req.socket.server === server].join());
    return;
  }
  const upstream = http.request({ port, host: "127.0.0.1", path: "/kinds", agent, method: "GET" }, answer => {
    const during = [kinds(answer.socket), kinds(answer.connection), kinds(answer.client), answer.socket === upstream.socket, upstream.reusedSocket, answer.socket.remotePort === port].join();
    let text = "";
    answer.setEncoding("utf8");
    answer.on("data", chunk => (text += chunk));
    answer.on("end", () => {
      setImmediate(() => res.end([during, kinds(answer.socket), kinds(upstream.socket), text].join(" | ")));
    });
  });
  upstream.on("socket", socket => lines.length < 3 && lines.push("socket event " + kinds(socket) + " " + (upstream.socket === socket)));
  upstream.end();
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
port = server.address().port;
const get = path => new Promise((done, fail) => http.get({ port, host: "127.0.0.1", path, agent: false }, answer => { let text = ""; answer.on("data", c => (text += c)); answer.on("end", () => done(text)); }).on("error", fail));
const seen = new Set();
for (let i = 0; i < 60; i++) seen.add(await get("/x"));
lines.push(...seen);

// A socket of the user's, a Duplex that carries a connection, a request whose socket is replaced.
const own = new http.Agent();
own.createConnection = (options, callback) => net.connect(options, callback);
const answer = await new Promise(done => http.get({ port, host: "127.0.0.1", path: "/kinds", agent: own }, done));
lines.push(kinds(answer.socket));
answer.resume();
class Pair extends Duplex {
  other;
  _read() {}
  _write(chunk, _, done) { this.other.push(chunk); done(); }
  _final(done) { this.other.push(null); done(); }
}
const a = new Pair(), b = new Pair();
a.other = b, b.other = a;
const overDuplex = await new Promise((done, fail) => {
  const request = http.request({ path: "/kinds", createConnection: () => a }, response => {
    let text = "";
    response.on("data", c => (text += c));
    response.on("end", () => done([kinds(response.socket), kinds(request.socket), text].join(" | ")));
  });
  request.on("error", fail);
  request.end();
  let head = "";
  b.on("data", c => {
    head += c;
    if (head.includes("\r\n\r\n")) b.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"), (head = "");
  });
});
lines.push("over a duplex: " + overDuplex);
const message = new http.IncomingMessage(new net.Socket());
lines.push([kinds(message.socket), kinds(message.client)].join());
message.socket = null;
lines.push(kinds(message.socket));
message.socket = { made: "up" };
lines.push(message.socket.made, kinds(new http.IncomingMessage(null).socket), kinds(new http.IncomingMessage().socket), kinds(new http.IncomingMessage(a).socket));
const outgoing = new http.OutgoingMessage();
lines.push(kinds(outgoing.socket));
outgoing.socket = new net.Socket();
lines.push(kinds(outgoing.socket), kinds(outgoing.connection));
outgoing.connection = null;
lines.push(kinds(outgoing.socket));
console.log(lines.join("\n"));
process.exit(0);
