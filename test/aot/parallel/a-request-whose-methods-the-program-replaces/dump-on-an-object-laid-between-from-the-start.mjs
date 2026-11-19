// One connection stays open, and a server answers its requests without a body and listens to nothing. The program lays a plain object between each request and the prototype of its class, as express does. That object holds a _dump of the program from the start.
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
prepare = req => {
  const holder = Object.create(above);
  lay(holder);
  Object.setPrototypeOf(req, holder);
};
await round("an object with _dump between");
socket.destroy();
server.close();
