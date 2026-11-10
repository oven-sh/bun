// The socket's _unrefTimer is called for every chunk of a body, in front of the chunk. A program that replaces it acts on the request there.
import http from "node:http";

const deeds = {
  "only counts": () => {},
  "pauses the request": (req, log) => { req.pause(); setTimeout(() => { log.push("resume"); req.resume(); }, 30); },
  "takes the listener of data off": (req, log, onData) => { req.off("data", onData); req.on("data", chunk => log.push("other " + chunk.length)); },
  "sets an encoding": req => { req.setEncoding("hex"); },
  "destroys the request": req => { req.destroy(); },
  "dumps the request": req => { req._dump(); },
  "throws": () => { throw new Error("made up"); },
};
process.on("uncaughtException", error => console.log("   uncaught: " + error.message));

for (const name in deeds) {
  const log = [];
  let laid;
  const isLaid = new Promise(done => (laid = done));
  const server = http.createServer((req, res) => {
    const onData = chunk => log.push("data " + (typeof chunk === "string" ? chunk : chunk.length));
    req.on("data", onData);
    req.on("end", () => { log.push("end"); res.end("ok"); });
    req.on("close", () => { log.push("close"); if (!res.writableEnded) res.end("closed"); });
    let calls = 0;
    // Behind the ticks in which the request begins to flow.
    setTimeout(() => {
      req.socket._unrefTimer = function () { if (calls++ === 0 && log.length === 0) { log.push("timer"); deeds[name](req, log, onData); } };
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
  console.log(name + ": " + log.join(" | "));
  server.close();
  server.closeAllConnections();
}
