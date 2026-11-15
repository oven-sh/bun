// Where a request is destroyed, `readableEnded` says whether it was aborted. The library asks whether a read of the name reaches the accessor of Readable.prototype, and where it does, does not read it. Whatever else a read would find counts. Each request is the first of its connection.
const http = require("node:http");
const net = require("node:net");

const deeds = {
  "nothing": () => {},
  "another name of its own": req => void (req.madeUp = false),
  "a defined value": req => void Object.defineProperty(req, "readableEnded", { configurable: true, writable: true, enumerable: true, value: false }),
  "an accessor": req => void Object.defineProperty(req, "readableEnded", { configurable: true, get: () => false }),
  "a value on a prototype laid between": req => void Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype, { readableEnded: { configurable: true, writable: true, value: false } })),
  "an accessor on a prototype laid between": req => void Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype, { readableEnded: { configurable: true, get: () => false } })),
  "a prototype laid between that holds nothing": req => void Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype)),
};
const ways = {
  "no body": { text: "GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n", handle: (req, res) => res.end("ok") },
  "a body left unread": { text: "POST / HTTP/1.1\r\nHost: a\r\nConnection: close\r\nContent-Length: 2\r\n\r\nab", handle: (req, res) => res.end("ok") },
  "a body that is read": {
    text: "POST / HTTP/1.1\r\nHost: a\r\nConnection: close\r\nContent-Length: 2\r\n\r\nab",
    handle: (req, res) => {
      req.on("data", () => {});
      req.on("end", () => res.end("ok"));
    },
  },
};

async function run(deed, way) {
  const seen = [];
  const server = http.createServer((req, res) => {
    deeds[deed](req);
    seen.push(req);
    ways[way].handle(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  for (let turn = 0; turn < 3; turn++)
    await new Promise(resolve => {
      const client = net.connect(server.address().port, "127.0.0.1", () => client.write(ways[way].text));
      client.on("error", () => {});
      client.on("data", () => {});
      client.on("close", resolve);
    });
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return seen.map(req => `${req.aborted ? "aborted" : "whole"}${req.destroyed ? "" : ", not destroyed"}${req.complete ? "" : ", not complete"}`).join(" | ");
}

process.on("uncaughtException", error => console.log("  escaped: " + error.message));
const guard = setTimeout(() => (console.log("it does not come to an end"), process.exit(1)), 30000);
(async () => {
  for (const deed of Object.keys(deeds)) for (const way of Object.keys(ways)) console.log(`${deed} . ${way}: ${await run(deed, way)}`);
  clearTimeout(guard);
  process.exit(0);
})();
