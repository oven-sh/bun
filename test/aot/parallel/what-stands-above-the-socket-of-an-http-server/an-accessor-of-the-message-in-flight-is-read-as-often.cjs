// An accessor laid on the socket in place of the response in flight throws at its first read. It is read as often as bun run reads it.
const http = require("node:http");
let reads = 0;
let stores = 0;
const heard = [];
process.on("uncaughtException", error => heard.push(error.message));
const server = http.createServer((req, res) => {
  let held = req.socket._httpMessage;
  Object.defineProperty(req.socket, "_httpMessage", {
    configurable: true,
    get() {
      if (reads++ === 0) throw new Error("made up");
      return held;
    },
    set(value) {
      stores++;
      held = value;
    },
  });
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  console.log(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text());
  setImmediate(() => {
    console.log("heard", heard.join(), "read", reads, "stored", stores);
    server.closeAllConnections();
    server.close();
  });
});
