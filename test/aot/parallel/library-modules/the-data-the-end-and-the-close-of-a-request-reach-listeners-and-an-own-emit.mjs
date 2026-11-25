// What was compiled ahead of time brings "data", "end" and "close" of a request to its listeners without a call of emit() where emit() is the one of node:events.
// A program sees: which listeners run, in which order, with which `this` and how many arguments; and an own `emit` on the request, which is called as plain calls it.
import http from "node:http";
const log = [];
const server = http.createServer((req, res) => {
  const how = req.headers.how;
  log.push("== " + how);
  if (how === "own") {
    const emit = req.emit;
    req.emit = function (type, ...rest) {
      if (type === "data" || type === "end" || type === "close") log.push("emit " + type + " " + rest.length);
      return emit.call(this, type, ...rest);
    };
  }
  req.on("data", c => log.push("data " + c));
  req.on("end", function () {
    log.push("end " + arguments.length + " " + (this === req));
  });
  req.on("end", () => log.push("end again"));
  req.once("close", () => log.push("close"));
  res.end("x");
});
const send = (port, how) =>
  new Promise(done => {
    const r = http.request(
      { port, host: "127.0.0.1", method: "POST", agent: false, headers: { how, "content-length": 3 } },
      res => {
        res.resume();
        res.on("close", () => setTimeout(done, 20));
      },
    );
    r.end("abc");
  });
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  await send(port, "plain");
  await send(port, "own");
  console.log(log.join("\n"));
  process.exit(0);
});
