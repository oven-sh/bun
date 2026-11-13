// Each field that a chunk of the body reads off the request, under an accessor of the program's that acts on the request at its first read.
import http from "node:http";

// Runs the event loop that many times: jobs, errors that nobody handles and what has arrived run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };

const deeds = {
  "only counts": () => {},
  "pauses the request": (req, log) => { req.pause(); spinEventLoop().then(() => { log.push("resume"); req.resume(); }); },
  "sets an encoding": req => { req.setEncoding("hex"); },
  "destroys the request": req => { req.destroy(); },
  "takes the listener of data off": (req, log, onData) => { req.off("data", onData); req.on("data", chunk => log.push("other " + chunk.length)); },
};
for (const field of ["socket", "_dumped", "upgrade", "_readableState"]) {
  for (const name in deeds) {
    const log = [];
    let laid, closed;
    const isLaid = new Promise(done => (laid = done));
    const isClosed = new Promise(done => (closed = done));
    const server = http.createServer((req, res) => {
      const onData = chunk => log.push("data " + (typeof chunk === "string" ? chunk : chunk.length));
      req.on("data", onData);
      req.on("end", () => { log.push("end"); res.end("ok"); });
      req.on("close", () => { log.push("close"); if (!res.writableEnded) res.end("closed"); closed(); });
      spinEventLoop().then(() => {
        let held = req[field], isFirst = true;
        Object.defineProperty(req, field, {
          configurable: true,
          get() { if (isFirst) { isFirst = false; log.push("read"); deeds[name](req, log, onData); } return held; },
          set(value) { held = value; },
        });
        laid();
      });
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    await new Promise(finish => {
      const done = async () => { await isClosed; await spinEventLoop(); finish(); };
      const client = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", headers: { "content-length": 5 } }, answer => {
        answer.resume();
        answer.on("end", done);
      });
      client.on("error", error => { log.push("client " + error.code); done(); });
      client.flushHeaders();
      isLaid.then(() => client.end("hello"));
    });
    console.log(field + ", " + name + ": " + log.join(" | "));
    server.close();
    server.closeAllConnections();
  }
}
