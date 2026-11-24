// Heirs of ServerResponse with fields of their own, filled late by the library: what they hold, list and write.
const http = require("node:http");
const util = require("node:util");
const { Writable } = require("node:stream");
const out = [];
function Plain(req) {
  http.ServerResponse.call(this, req);
  this.first = 1;
  this.second = "two";
}
util.inherits(Plain, http.ServerResponse);
function Below(req) {
  Plain.call(this, req);
  this.third = [3];
  this.kMine = { x: 0.5 };
}
Object.setPrototypeOf(Below.prototype, Plain.prototype);
class Classy extends http.ServerResponse {
  fourth = -0;
  constructor(req) {
    super(req);
    this.fifth = null;
  }
  late() {
    this.sixth = 6.5;
    this.timeout = 7;
    return this;
  }
}
class Lower extends Classy {
  seventh = true;
  late() {
    this.eighth = "8";
    return super.late();
  }
}
function show(value) {
  return value === undefined ? "u" : value === null ? "n" : Object.is(value, -0) ? "-0" : typeof value === "object" ? (Array.isArray(value) ? "[" + value + "]" : "o") : typeof value === "function" ? "f" : String(value);
}
function keysOf(res) {
  return Reflect.ownKeys(res)
    .map(key => (typeof key === "symbol" ? "@" + key.description : key))
    .join();
}
function respond(Response, method, how) {
  const req = { method, httpVersionMajor: 1, httpVersionMinor: how & 1, headers: {} };
  const res = new Response(req);
  let written = "";
  const socket = new Writable({
    write(chunk, encoding, callback) {
      written += chunk.toString("latin1").replace(/Date: [^\r]*/, "Date: now");
      callback();
    },
  });
  out.push(keysOf(res));
  if (how & 2) res.assignSocket(socket);
  else res.socket = socket;
  const steps = [
    () => res.late?.(),
    () => res.setHeader("x-a", how),
    () => how & 32 && res.removeHeader("connection"),
    () => how & 4 && (res.statusCode = 204),
    () => how & 8 && res.writeHead(201, "Made", { "x-b": "c" }),
    () => how & 16 && res.write("part " + how),
    () => res.setHeader("x-late", "d"),
    () => res.end(how & 4 ? undefined : "end " + how),
  ];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      out.push(error.code ?? error.name);
    }
  }
  out.push(keysOf(res), written.split("\r\n").join("|"));
  out.push([res.first, res.second, res.third, res.fourth, res.fifth, res.sixth, res.seventh, res.eighth, res.timeout, res.headersSent, res.finished, res.statusCode, res.statusMessage, res.writableEnded, res.chunkedEncoding, res.shouldKeepAlive, res._header === null].map(show).join());
  const copy = Object.assign({}, res);
  out.push(Object.keys(copy).length, show(copy.third), show(copy.seventh), Object.keys(res).filter(key => !key.startsWith("_")).join());
}
for (const Response of [http.ServerResponse, Plain, Below, Classy, Lower]) {
  for (let how = 0; how < 64; how += 3) respond(Response, how % 5 ? "GET" : "HEAD", how);
}
Object.defineProperty(Below.prototype, "statusMessage", { get() { return "got"; }, set(value) { out.push("set " + show(value)); }, configurable: true });
for (let how = 0; how < 64; how += 7) respond(Below, "GET", how);
console.log(out.join("\n"));
