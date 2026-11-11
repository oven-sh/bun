// The accessor is laid by a listener for `end`, so its first read is that of the request's own destruction, which follows the event: the error closes the request as an error out of _destroy() does.
import http from "node:http";
const own = Object.getOwnPropertyDescriptor(process, "nextTick");
const lines = [];
process.on("uncaughtException", error => lines.push("uncaught: " + error.message));
const server = http.createServer((req, res) => {
  req.on("error", error => lines.push("the request emits error: " + error.message));
  req.on("close", () => lines.push("the request closes, destroyed " + req.destroyed + ", errored " + (req.errored && req.errored.message)));
  req.on("end", () => {
    let reads = 0;
    Object.defineProperty(process, "nextTick", {
      configurable: true,
      get() {
        if (++reads === 1) throw new Error("the first read");
        return own.value;
      },
    });
    setImmediate(() => {
      Object.defineProperty(process, "nextTick", own);
      res.end("ok");
    });
  });
  req.resume();
});
server.listen(0, "127.0.0.1", async () => {
  for (const options of [{}, { method: "POST", body: "sent" }]) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/", options);
    lines.push(response.status + " " + (await response.text()));
  }
  console.log(lines.join("\n"));
  server.close();
});
