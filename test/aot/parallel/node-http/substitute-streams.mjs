// COUNTER: FieldsEvictedByTypeMismatch <= 12
// A response made by the program, of a request that is a stream of its own, with a Writable in a connection's place: both stay in their fields.
import http from "node:http";
import { PassThrough, Readable, Writable } from "node:stream";
import util from "node:util";
const out = [];
const say = (...values) => out.push(values.map(String).join(" "));
function Request(options) {
  Readable.call(this, { autoDestroy: false });
  this.method = options.method;
  this.url = options.url;
  this.headers = options.headers ?? {};
  this.httpVersionMajor = 1;
  this.httpVersionMinor = 1;
  this.socket = this.connection = { remoteAddress: "127.0.0.1" };
}
util.inherits(Request, Readable);
Request.prototype._read = function () {
  this.push(null);
};
const written = [];
const nullSocket = () => new Writable({ write(chunk, encoding, callback) { written.push(String(chunk).length); setImmediate(callback); } });
function Response(request, finish) {
  http.ServerResponse.call(this, request);
  this.parts = [];
  this.setHeader("x-first", "1");
  this.assignSocket(nullSocket());
  this.once("finish", () => finish(this));
  this.connection.once("error", () => {});
}
util.inherits(Response, http.ServerResponse);
Response.prototype.write = function (data, encoding, callback) {
  this.parts.push(Buffer.from(data, encoding));
  if (callback) setImmediate(callback);
  return true;
};
Response.prototype.end = function (data, encoding, callback) {
  if (data) this.write(data, encoding);
  http.ServerResponse.prototype.end.call(this, callback);
  this.emit("finish");
  this.destroy();
};
class Below extends http.ServerResponse {
  constructor(request, socket) {
    super(request);
    this.assignSocket(socket);
  }
}
const inject = options =>
  new Promise(resolve => {
    const request = new Request(options);
    const response = new Response(request, done => resolve({ status: done.statusCode, text: Buffer.concat(done.parts).toString(), request: done.req === request, socket: done.socket === done.connection, kind: done.socket?.constructor.name }));
    response.statusCode = options.status ?? 200;
    if (options.head) response.writeHead(options.status ?? 200, options.head);
    response.end("body of " + request.url);
  });
for (let i = 0; i < 200; i++) {
  const answer = await inject({ method: i % 3 ? "GET" : "HEAD", url: "/" + i, status: i % 5 ? 200 : 404, head: i % 7 ? undefined : { "x-count": String(i) } });
  if (i % 50 === 0) say(JSON.stringify(answer));
}
// The fields take whatever the program hands over, and say what they hold.
const request = new Request({ method: "GET", url: "/one" });
const both = new PassThrough();
const below = new Below(request, both);
say(below.req === request, below.socket === both, below.connection === both, below.writableLength, below.writableHighWaterMark === both.writableHighWaterMark);
below.detachSocket(both);
say(below.socket, below.connection);
const plain = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} });
say(Object.keys(plain.req).join(), plain.socket === null || plain.socket === undefined || typeof plain.socket);
plain.req = request;
say(plain.req === request);
plain.req = new http.IncomingMessage(null);
say(plain.req instanceof http.IncomingMessage, plain.req.socket);
plain.req = 5;
say(plain.req, typeof plain.req);
plain.socket = both;
say(plain.socket === both, plain.connection === both);
plain.socket = null;
say(plain.socket);
const outgoing = new http.OutgoingMessage();
outgoing.socket = both;
say(outgoing.socket === both, outgoing.writableLength);
outgoing.connection = nullSocket();
say(outgoing.socket instanceof Writable, outgoing.connection === outgoing.socket);
const last = new Below(new Readable({ read() {} }), nullSocket());
last.writeHead(201, { "content-length": 2 });
last.end("ok");
await new Promise(resolve => setTimeout(resolve, 20));
say(last.headersSent, last.finished, last.writableEnded, written.length > 0);
console.log(out.join("\n"));
