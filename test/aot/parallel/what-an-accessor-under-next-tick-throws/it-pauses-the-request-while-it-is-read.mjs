// The accessor throws nothing: at its first read, in the midst of the resume() of _dump(), it pauses the request. What resume() stores behind the read is laid over that, bit by bit, and nothing else.
import http from "node:http";
const own = Object.getOwnPropertyDescriptor(process, "nextTick");
const server = http.createServer((req, res) => {
  let reads = 0;
  Object.defineProperty(process, "nextTick", {
    configurable: true,
    get() {
      if (++reads === 1) req.pause();
      return own.value;
    },
  });
  req._dump();
  Object.defineProperty(process, "nextTick", own);
  console.log("flowing " + req.readableFlowing + " | paused " + req.isPaused() + " | dumped " + req._dumped);
  req.on("close", () => console.log("closed, ended " + req.readableEnded));
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/");
  console.log(response.status, await response.text());
  setTimeout(() => server.close(), 20);
  server.closeAllConnections();
});
