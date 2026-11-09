// A server answers requests without a body. In each round the program has replaced one method of the request in one place, and counts how often the server comes by.
import http from "node:http";
import net from "node:net";
import { Readable, Stream } from "node:stream";
import { EventEmitter } from "node:events";

const names = ["emit", "_dump", "removeAllListeners", "resume", "read", "_read", "push", "destroy", "_destroy", "listenerCount"];
const holders = { IncomingMessage: http.IncomingMessage.prototype, Readable: Readable.prototype, Stream: Stream.prototype, EventEmitter: EventEmitter.prototype };
let calls = [];
let prepare = () => {};
const server = http.createServer((req, res) => {
  prepare(req);
  res.on("finish", () => setImmediate(() => calls.push(`ended ${req.readableEnded} destroyed ${req.destroyed} complete ${req.complete}`)));
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

function ask() {
  return new Promise(resolve => {
    let text = "";
    const socket = net.connect(server.address().port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
    socket.setEncoding("latin1");
    socket.on("data", chunk => (text += chunk));
    socket.on("close", () => setTimeout(resolve, 5, text.split("\r\n")[0]));
  });
}

async function round(label) {
  calls = [];
  for (let i = 0; i < 3; i++) calls.push(await ask());
  console.log(label, "|", calls.join(" . "));
}

function counted(name, original) {
  return function (...args) {
    calls.push(name + (name === "emit" || name === "listenerCount" || name === "removeAllListeners" ? ":" + String(args[0]) : ""));
    return original.apply(this, args);
  };
}

await round("untouched");

for (const name of names) {
  prepare = req => {
    req[name] = counted(name, req[name]);
  };
  await round(`own ${name}`);
}
prepare = () => {};
await round("untouched again");

for (const name of names) {
  for (const holder in holders) {
    const object = holders[holder];
    const had = Object.getOwnPropertyDescriptor(object, name);
    let inherited = object[name];
    if (typeof inherited !== "function") continue;
    object[name] = counted(`${holder}.${name}`, inherited);
    await round(`${holder}.prototype.${name} stored`);
    if (had) Object.defineProperty(object, name, had);
    else delete object[name];
    await round(`${holder}.prototype.${name} as it was`);
  }
}

for (const name of names) {
  const object = http.IncomingMessage.prototype;
  const had = Object.getOwnPropertyDescriptor(object, name);
  const inherited = object[name];
  let reads = 0;
  Object.defineProperty(object, name, { configurable: true, get() { reads++; return inherited; }, set(value) { Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: true }); } });
  await round(`an accessor under ${name}`);
  console.log("  was read:", reads > 0);
  if (had) Object.defineProperty(object, name, had);
  else delete object[name];
}

prepare = req => {
  Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype, { read: { value: counted("below.read", Readable.prototype.read), writable: true, configurable: true }, _dump: { value: counted("below._dump", http.IncomingMessage.prototype._dump), writable: true, configurable: true } }));
};
await round("a prototype laid below with read and _dump");
prepare = req => {
  Object.defineProperty(req, "readableEnded", { configurable: true, get() { calls.push("own readableEnded"); return false; } });
};
await round("an own readableEnded");
prepare = () => {};
await round("untouched at last");
server.close();
