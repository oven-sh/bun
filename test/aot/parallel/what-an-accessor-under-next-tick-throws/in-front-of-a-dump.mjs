// An accessor under process.nextTick throws at its first read. It is laid in front of req._dump(), whose resume() reads the name: the error comes out of _dump(), and the request is left as resume() leaves it there.
import http from "node:http";
const own = Object.getOwnPropertyDescriptor(process, "nextTick");
const server = http.createServer((req, res) => {
  let reads = 0;
  Object.defineProperty(process, "nextTick", {
    configurable: true,
    get() {
      if (++reads === 1) throw new Error("the first read");
      return own.value;
    },
  });
  let said = "nothing is thrown";
  try {
    req._dump();
  } catch (error) {
    said = "out of _dump(): " + error.message;
  }
  Object.defineProperty(process, "nextTick", own);
  console.log(said + " | flowing " + req.readableFlowing + " | paused " + req.isPaused() + " | dumped " + req._dumped);
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/");
  console.log(response.status, await response.text());
  server.close();
});
