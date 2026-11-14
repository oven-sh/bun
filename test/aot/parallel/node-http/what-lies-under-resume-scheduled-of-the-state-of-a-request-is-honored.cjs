// When a response has finished, the body of a request that nobody has read is dumped, unless a resume is scheduled: `req._readableState.resumeScheduled`.
// What a program lays under that name is asked and its answer honored. Each deed has a connection of its own.
// The accessor of the library on the prototype of the state is not configurable: nobody replaces or deletes it.
const http = require("node:http");
const net = require("node:net");
const between = (state, descriptor) =>
  Object.setPrototypeOf(state, Object.create(Object.getPrototypeOf(state), { resumeScheduled: descriptor }));
const deeds = {
  nothing() {},
  "a getter in between": (state, note) => between(state, { configurable: true, get: note }),
  "a value in between": state => between(state, { configurable: true, writable: true, value: true }),
  "an own getter": (state, note) => Object.defineProperty(state, "resumeScheduled", { configurable: true, get: note }),
  "an own value": state => Object.defineProperty(state, "resumeScheduled", { configurable: true, writable: true, value: true }),
};
const names = Object.keys(deeds);
let name = "";
const server = http.createServer((req, res) => {
  let asked = 0;
  deeds[name](req._readableState, () => (asked++, true));
  res.on("close", () =>
    setImmediate(() => {
      console.log(name + ": asked " + (asked > 0) + " . dumped " + !!req._dumped);
      next();
    }),
  );
  res.end("ok");
});
function next() {
  if (names.length === 0) return void server.close();
  name = names.shift();
  const client = net.connect(server.address().port, "127.0.0.1", () =>
    client.write("POST / HTTP/1.1\r\nHost: a\r\nConnection: close\r\nContent-Length: 6\r\n\r\nposted"),
  );
  client.resume();
}
server.listen(0, "127.0.0.1", next);
