// An accessor under process.nextTick throws once the request without a body is being read. The read catches what _read() throws and destroys the request with it: `aborted`, `error` and `close`, and nothing is uncaught.
import http from "node:http";
import net from "node:net";
const original = process.nextTick;
const pause = ms => new Promise(done => setTimeout(done, ms));
const restore = () =>
  Object.defineProperty(process, "nextTick", { configurable: true, writable: true, value: original });
process.on("uncaughtException", error => {
  restore();
  console.log("uncaught: " + error.message);
});
let watched = null;
const server = http.createServer((req, res) => {
  if (req.url === "/warm") return void res.end("warm");
  for (const name of ["aborted", "error", "close"]) {
    req.on(name, error => {
      if (name === "close") restore();
      const state = req._readableState;
      console.log(
        req.url,
        name,
        error ? error.message : "-",
        "destroyed",
        req.destroyed,
        "errored",
        req.errored ? req.errored.message : "none",
        "ended",
        state.ended,
      );
    });
  }
  if (req.url === "/throws") {
    watched = req;
    Object.defineProperty(process, "nextTick", {
      configurable: true,
      get() {
        if (watched !== null && watched._consuming) {
          const state = watched._readableState;
          console.log(
            "read while: reading",
            state.reading,
            "sync",
            state.sync,
            "resumeScheduled",
            state.resumeScheduled,
            "flowing",
            state.flowing,
          );
          watched = null;
          throw new Error("out of the accessor");
        }
        return original;
      },
    });
  }
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  for (const path of ["/control", "/throws"]) {
    const socket = net
      .connect(server.address().port, "127.0.0.1")
      .on("error", () => {})
      .on("data", () => {});
    for (const url of ["/warm", path]) {
      socket.write(`GET ${url} HTTP/1.1\r\nHost: a\r\n\r\n`);
      await pause(80);
    }
    socket.destroy();
  }
  server.closeAllConnections();
  server.close();
});
