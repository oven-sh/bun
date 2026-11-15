// A server prints the headers of each request. In each round the program has laid raw headers of its own in one place: on the request, on an object laid between it and its class, or on the prototype of all requests.
import http from "node:http";
import net from "node:net";

const above = http.IncomingMessage.prototype;
const original = Object.getOwnPropertyDescriptor(above, "rawHeaders");
let lines = [];
let prepare = () => {};
const server = http.createServer((req, res) => {
  prepare(req);
  lines.push(JSON.stringify(req.headers) + " " + JSON.stringify(req.rawHeaders) + " " + JSON.stringify(req.headersDistinct));
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

function ask() {
  return new Promise(resolve => {
    const socket = net.connect(server.address().port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\nX-One: 1\r\nConnection: close\r\n\r\n"));
    socket.resume();
    socket.on("close", () => setTimeout(resolve, 5));
  });
}

async function round(label, between = () => {}) {
  lines = [];
  for (let i = 0; i < 3; i++) {
    await ask();
    between(i);
  }
  console.log(label);
  for (const line of lines) console.log("  " + line);
}

const made = ["Host", "made-up", "X-Two", "2", "X-Three", "3"];
const accessor = { configurable: true, get: () => made, set() {} };
const value = { configurable: true, writable: true, value: made };

await round("nothing is laid");
for (const [kind, descriptor] of [["an accessor", accessor], ["a value", value]]) {
  prepare = req => Object.defineProperty(req, "rawHeaders", descriptor);
  await round(`${kind} on each request`);

  prepare = req => Object.setPrototypeOf(req, Object.create(above, { rawHeaders: descriptor }));
  await round(`${kind} on an object laid between, from the start`);

  prepare = req => {
    const holder = Object.create(above);
    Object.setPrototypeOf(req, holder);
    Object.defineProperty(holder, "rawHeaders", descriptor);
  };
  await round(`${kind} on an object laid between, amid the request`);

  const shared = Object.create(above);
  prepare = req => Object.setPrototypeOf(req, shared);
  await round(`${kind} on an object laid between, behind the first request, gone behind the second`, i => {
    if (i === 0) Object.defineProperty(shared, "rawHeaders", descriptor);
    if (i === 1) delete shared.rawHeaders;
  });

  prepare = () => {};
  await round(`${kind} on the prototype of all requests, behind the first request, as it was behind the second`, i => {
    try {
      if (i === 0) Object.defineProperty(above, "rawHeaders", descriptor);
      if (i === 1) Object.defineProperty(above, "rawHeaders", original);
    } catch (error) {
      lines.push("is refused: " + error.name);
    }
  });
}

prepare = req => Object.setPrototypeOf(req, Object.create(above));
await round("an empty object laid between");
prepare = req => {
  req.rawHeaders = made;
};
await round("a store on each request");
class Heir extends http.IncomingMessage {
  get rawHeaders() {
    return made;
  }
  set rawHeaders(_) {}
}
prepare = req => Object.setPrototypeOf(req, Heir.prototype);
await round("the prototype of an heir with an accessor");
prepare = () => {};
await round("nothing is laid at last");
server.close();
