// Each field that a chunk of the body reads off the request, under an accessor of the program's that acts on the request at its first read.
import http from "node:http";

const deeds = {
  "only counts": () => {},
  "pauses the request": (req, log) => { req.pause(); setTimeout(() => { log.push("resume"); req.resume(); }, 30); },
  "sets an encoding": req => { req.setEncoding("hex"); },
  "destroys the request": req => { req.destroy(); },
  "takes the listener of data off": (req, log, onData) => { req.off("data", onData); req.on("data", chunk => log.push("other " + chunk.length)); },
};
for (const field of ["socket", "_dumped", "upgrade", "_readableState"]) {
  for (const name in deeds) {
    const log = [];
    let laid;
    const isLaid = new Promise(done => (laid = done));
    const server = http.createServer((req, res) => {
      const onData = chunk => log.push("data " + (typeof chunk === "string" ? chunk : chunk.length));
      req.on("data", onData);
      req.on("end", () => { log.push("end"); res.end("ok"); });
      req.on("close", () => { log.push("close"); if (!res.writableEnded) res.end("closed"); });
      setTimeout(() => {
        let held = req[field], isFirst = true;
        Object.defineProperty(req, field, {
          configurable: true,
          get() { if (isFirst) { isFirst = false; log.push("read"); deeds[name](req, log, onData); } return held; },
          set(value) { held = value; },
        });
        laid();
      }, 5);
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    await new Promise(finish => {
      let isDone = false;
      const done = () => { if (!isDone) { isDone = true; clearTimeout(limit); finish(); } };
      const limit = setTimeout(() => { log.push("no answer"); client.destroy(); done(); }, 500);
      const client = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", headers: { "content-length": 5 } }, answer => {
        answer.resume();
        answer.on("end", () => setTimeout(done, 80));
      });
      client.on("error", error => { log.push("client " + error.code); setTimeout(done, 80); });
      client.flushHeaders();
      isLaid.then(() => client.end("hello"));
    });
    console.log(field + ", " + name + ": " + log.join(" | "));
    server.close();
    server.closeAllConnections();
  }
}
