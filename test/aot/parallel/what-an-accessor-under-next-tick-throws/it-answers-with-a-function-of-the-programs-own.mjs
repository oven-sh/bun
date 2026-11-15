// The accessor answers with a function of the program's own: _dump() hands it the callback of the long road, once, and the request is dumped all the same.
import http from "node:http";
const own = Object.getOwnPropertyDescriptor(process, "nextTick");
const server = http.createServer((req, res) => {
  const handed = [];
  Object.defineProperty(process, "nextTick", {
    configurable: true,
    get() {
      return function (callback, ...rest) {
        handed.push(callback.name + " with " + rest.length);
        return own.value.call(process, callback, ...rest);
      };
    },
  });
  req._dump();
  Object.defineProperty(process, "nextTick", own);
  console.log(handed.join(", ") + " | flowing " + req.readableFlowing + " | dumped " + req._dumped);
  req.on("close", () => console.log("closed, ended " + req.readableEnded));
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/");
  console.log(response.status, await response.text());
  server.close();
});
