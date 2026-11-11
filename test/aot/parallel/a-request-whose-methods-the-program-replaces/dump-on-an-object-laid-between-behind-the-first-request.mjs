// One connection stays open, and a server answers its requests without a body and listens to nothing. The program lays a plain object between each request and the prototype of its class, as express does. One object serves all requests, has a method of its own, and gets a _dump of the program behind the first request.
import http from "node:http";
import net from "node:net";

let calls = [];
let last;
let prepare = () => {};
const server = http.createServer((req, res) => {
  prepare(req);
  last = req;
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const socket = net.connect(server.address().port, "127.0.0.1");
socket.setEncoding("latin1");
let text = "";
let arrived = () => {};
socket.on("data", chunk => {
  text += chunk;
  if (text.endsWith("ok")) arrived();
});

function ask() {
  return new Promise(resolve => {
    text = "";
    arrived = () => setTimeout(() => resolve(text.split("\r\n")[0]), 5);
    socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
}

async function round(label, between = () => {}) {
  calls = [];
  for (let i = 0; i < 3; i++) {
    calls.push(await ask());
    calls.push(`ended ${last.readableEnded} destroyed ${last.destroyed} complete ${last.complete}`);
    between(i);
  }
  console.log(label, "|", calls.join(" . "));
}

const above = http.IncomingMessage.prototype;
function lay(holder) {
  const original = above._dump;
  holder._dump = function (...values) {
    calls.push("_dump");
    return original.apply(this, values);
  };
}

await round("nothing between");
const shared = Object.create(above);
shared.header = function (name) {
  return this.headers[name];
};
prepare = req => Object.setPrototypeOf(req, shared);
await round("one object between for all requests, which gets _dump behind the first", i => {
  if (i === 0) lay(shared);
});
socket.destroy();
server.close();
