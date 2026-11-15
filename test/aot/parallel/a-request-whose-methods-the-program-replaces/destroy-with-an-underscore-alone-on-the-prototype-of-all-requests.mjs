// One connection stays open, and a server answers its requests without a body and listens to nothing. Behind the first round the program stores a function of its own under one name, _destroy, on the prototype of all requests, and touches nothing else.
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
  for (let i = 0; i < 2; i++) {
    calls.push(await ask());
    calls.push(`ended ${last.readableEnded} destroyed ${last.destroyed} complete ${last.complete}`);
    between(i);
  }
  console.log(label, "|", calls.join(" . "));
}

await round("as made");
const original = http.IncomingMessage.prototype._destroy;
http.IncomingMessage.prototype._destroy = function (...values) {
  calls.push("_destroy" + (typeof values[0] === "string" ? ":" + values[0] : ""));
  return original.apply(this, values);
};
await round("the program's _destroy");
socket.destroy();
server.close();
