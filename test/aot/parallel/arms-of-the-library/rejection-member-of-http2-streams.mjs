// The member of HTTP/2 streams for rejections of listeners, and what a request does with it.
import http2 from "node:http2";
import { EventEmitter, once } from "node:events";
const say = (...parts) => console.log("#", ...parts);
const show = error => (error ? `${error.name} ${error.code ?? ""} ${error.message}` : String(error));
EventEmitter.captureRejections = process.argv[2] !== "off";
const server = http2.createServer();
server.on("error", error => say("server error", show(error)));
server.on("sessionError", error => say("session error", show(error)));
let kinds = 0;
server.on("stream", async (stream, headers) => {
  if (!kinds++) {
    for (let proto = Object.getPrototypeOf(stream), depth = 0; proto && depth < 4; proto = Object.getPrototypeOf(proto), depth++) {
      const keys = Reflect.ownKeys(proto);
      say(proto.constructor.name, keys.length, keys.filter(key => typeof key === "symbol").map(String).join());
      const own = Object.getOwnPropertyDescriptor(proto, EventEmitter.captureRejectionSymbol);
      if (own) say(typeof own.value, own.value.name, own.value.length, own.enumerable, own.writable, own.configurable, "prototype" in own.value, (() => { try { new own.value(); return "made"; } catch (error) { return error.name; } })(), proto.propertyIsEnumerable(EventEmitter.captureRejectionSymbol));
      let names = []; for (const name in proto) names.push(name); say(names.join());
    }
  }
  stream.on("error", error => say("server stream", show(error)));
  const path = headers[":path"];
  if (path === "/reject") { await null; throw new Error("rejected listener"); }
  if (path === "/data") { stream.on("data", async chunk => { throw new Error("data " + chunk); }); stream.on("end", () => {}); stream.respond(); return; }
  stream.respond({ ":status": 200, "x-path": path }); stream.end("hello " + path);
});
server.listen(0, "127.0.0.1", async () => {
  const client = http2.connect("http://127.0.0.1:" + server.address().port);
  client.on("error", error => say("client", show(error)));
  const ask = (path, body) => new Promise(resolve => {
    const request = client.request({ ":path": path, ":method": body === undefined ? "GET" : "POST" }); let text = ""; const order = [];
    for (const name of ["response", "aborted", "error", "end", "close", "ready", "finish"]) request.on(name, value => order.push(name + (name === "error" ? " " + show(value) : "")));
    request.on("data", chunk => (text += chunk)); request.on("close", () => setImmediate(() => resolve([path, text, request.rstCode, request.destroyed, Object.keys(request).length, order.join()].join(" | ")))); request.end(body);
  });
  for (const path of ["/a", "/b"]) say(await ask(path));
  if (EventEmitter.captureRejections) { say(await ask("/reject")); say(await ask("/data", "chunk")); }
  say(await ask("/c", "body"));
  const request = client.request({ ":path": "/listener" });
  if (EventEmitter.captureRejections) { request.on("response", async () => { throw new Error("client listener"); }); request.on("error", error => say("request", show(error))); }
  request.resume(); await new Promise(resolve => request.on("close", resolve)); say("closed", request.rstCode);
  client.close(); server.close();
});
