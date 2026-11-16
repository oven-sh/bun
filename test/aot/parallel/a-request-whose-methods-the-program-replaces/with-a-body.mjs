// The same with a body that the program reads, by `data` listeners and by `readable`, and with a class of the program's own below IncomingMessage.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

let calls = [];
let prepare = () => {};
let byReadable = false;
function handle(req, res) {
  prepare(req);
  let body = "";
  req.setEncoding("utf8");
  if (byReadable) {
    req.on("readable", () => {
      for (let chunk; (chunk = req.read()) !== null; ) body += chunk;
    });
  } else {
    req.on("data", chunk => (body += chunk));
  }
  req.on("end", () => res.end(String(body.length)));
  req.on("close", () => calls.push(`closed destroyed ${req.destroyed} ended ${req.readableEnded}`));
}

function counted(name, original) {
  return function (...args) {
    calls.push(name);
    return original.apply(this, args);
  };
}

function ask(port) {
  return new Promise(resolve => {
    let text = "";
    const socket = net.connect(port, "127.0.0.1", () => socket.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello world"));
    socket.setEncoding("latin1");
    socket.on("data", chunk => (text += chunk));
    socket.on("close", () => setTimeout(resolve, 5, text.split("\r\n\r\n")[1]));
  });
}

async function rounds(server, label) {
  for (byReadable of [false, true]) {
    calls = [];
    for (let i = 0; i < 3; i++) calls.push(await ask(server.address().port));
    console.log(label, byReadable ? "readable" : "data", "|", calls.join(" . "));
  }
}

const server = http.createServer(handle);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await rounds(server, "untouched");
for (const name of ["read", "_read", "push", "destroy", "_destroy"]) {
  prepare = req => {
    req[name] = counted(name, req[name]);
  };
  await rounds(server, `own ${name}`);
  prepare = () => {};
  for (const [holder, object] of [["IncomingMessage", http.IncomingMessage.prototype], ["Readable", Readable.prototype]]) {
    const had = Object.getOwnPropertyDescriptor(object, name);
    object[name] = counted(`${holder}.${name}`, object[name]);
    await rounds(server, `${holder}.prototype.${name} stored`);
    if (had) Object.defineProperty(object, name, had);
    else delete object[name];
    await rounds(server, `${holder}.prototype.${name} as it was`);
  }
}
server.close();

// A stream that gets a _read and a _destroy of its own leaves the requests as they are.
for await (const chunk of Readable.from(["a", "b"])) calls.push(chunk);
const second = http.createServer(handle);
await new Promise(resolve => second.listen(0, "127.0.0.1", resolve));
await rounds(second, "behind Readable.from()");
second.close();

class Heir extends http.IncomingMessage {
  read(size) {
    calls.push("Heir.read");
    return super.read(size);
  }
  _read(size) {
    calls.push("Heir._read");
    return super._read(size);
  }
  push(chunk, encoding) {
    calls.push("Heir.push");
    return super.push(chunk, encoding);
  }
  destroy(error) {
    calls.push("Heir.destroy");
    return super.destroy(error);
  }
  _destroy(error, callback) {
    calls.push("Heir._destroy");
    return super._destroy(error, callback);
  }
}
const third = http.createServer({ IncomingMessage: Heir }, handle);
await new Promise(resolve => third.listen(0, "127.0.0.1", resolve));
await rounds(third, "an heir");
third.close();
