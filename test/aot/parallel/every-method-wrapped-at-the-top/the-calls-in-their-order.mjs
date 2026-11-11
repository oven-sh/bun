// As tracers do: the first thing the program does is to wrap every method on the prototypes of requests, responses, sockets, streams and emitters. The calls that reach the wrappers, in their order, with the kinds of their arguments, and the answer on the wire.
import http from "node:http";
import net from "node:net";
import stream from "node:stream";
import EventEmitter from "node:events";

let seen = [];
let watched = new Map();
const kinds = value => (value === null ? "null" : Array.isArray(value) ? "list" : typeof value === "string" && value.length < 12 ? JSON.stringify(value) : typeof value);
const text = key => (typeof key === "symbol" ? "[" + String(key.description) + "]" : key);
const holders = new Map([["ServerResponse", http.ServerResponse.prototype], ["OutgoingMessage", http.OutgoingMessage.prototype], ["IncomingMessage", http.IncomingMessage.prototype], ["Socket", net.Socket.prototype], ["Duplex", stream.Duplex.prototype], ["Writable", stream.Writable.prototype], ["Readable", stream.Readable.prototype], ["Stream", stream.Stream.prototype], ["EventEmitter", EventEmitter.prototype]]);
for (const [holderName, holder] of holders)
  for (const key of Reflect.ownKeys(holder)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(holder, key);
    if (key === "constructor" || typeof descriptor.value !== "function" || !descriptor.writable) continue;
    const original = descriptor.value;
    holder[key] = function (...values) {
      const who = watched.get(this);
      if (who) seen.push(who + "." + text(key) + "@" + holderName + "(" + values.map(kinds).join(" ") + ")");
      return Reflect.apply(original, this, values);
    };
  }
const answers = {
  "end with a text": (req, res) => res.end("ok"),
  "a head, two writes, end": (req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.write("a"); res.write("b"); res.end(); },
  "headers set one by one": (req, res) => { res.statusCode = 202; res.setHeader("x-made-up", "1"); res.setHeader("x-other", ["a", "b"]); res.removeHeader("x-made-up"); res.end("ok"); },
  "the body by listeners": (req, res) => { const parts = []; req.on("data", part => parts.push(part)); req.on("end", () => res.end(String(Buffer.concat(parts).length))); },
  "the body in a loop": async (req, res) => { let size = 0; for await (const part of req) size += part.length; res.end(String(size)); },
  "the body thrown away": (req, res) => { req.resume(); req.on("end", () => res.end("ok")); },
  "the body piped back": (req, res) => { req.pipe(res); },
  "both ends awaited": (req, res) => { stream.finished(req, () => {}); stream.finished(res, () => {}); req.resume(); res.end("ok"); },
  "a json": (req, res) => { const body = JSON.stringify({ a: 1 }); res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) }); res.end(body); },
  "the request destroyed": (req, res) => { req.destroy(); res.end("ok"); },
};
let current;
const server = http.createServer((req, res) => {
  if (req.url === "/first") { req.resume(); return void res.end("first"); }
  watched = new Map([[req, "req"], [res, "res"], [req.socket, "socket"]]);
  try { Promise.resolve(answers[current](req, res)).catch(error => seen.push("REJECTED " + (error?.code ?? error?.name))); } catch (error) { seen.push("THREW " + (error?.code ?? error?.name)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
function send(agent, path, method, body) {
  return new Promise(resolve => {
    const request = http.request({ port, host: "127.0.0.1", method, path, agent }, response => {
      const parts = [];
      response.on("data", part => parts.push(part));
      response.on("close", () => {
        clearTimeout(patience);
        const heads = [];
        for (let at = 0; at < response.rawHeaders.length; at += 2) heads.push(response.rawHeaders[at] + ": " + (response.rawHeaders[at].toLowerCase() === "date" ? "*" : response.rawHeaders[at + 1]));
        resolve(response.statusCode + " " + response.statusMessage + " {" + heads.join("; ") + "} " + JSON.stringify(String(Buffer.concat(parts)).slice(0, 24)));
      });
    });
    request.on("error", error => { clearTimeout(patience); resolve("failed " + error.code); });
    const patience = setTimeout(() => { request.destroy(); resolve("no answer"); }, 1000);
    request.end(body);
  });
}
const turn = () => new Promise(resolve => setImmediate(resolve));
process.on("uncaughtException", error => seen.push("UNCAUGHT " + (error?.code ?? error?.name)));
for (const answer in answers) {
  current = answer; seen = []; watched = new Map();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await send(agent, "/first", "GET");
  for (let i = 0; i < 4; i++) await turn();
  const takesBody = answer.includes("body") || answer.includes("both ends");
  const said = await send(agent, "/second", takesBody ? "POST" : "GET", takesBody ? "x".repeat(1000) : undefined);
  for (let i = 0; i < 6; i++) await turn();
  watched = new Map();
  agent.destroy();
  console.log("== " + answer + ": " + said + " | " + seen.length + " calls");
  for (const call of seen) console.log("   " + call);
}
process.exit(0);
