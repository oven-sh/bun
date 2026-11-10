// A request with an encoding hands each chunk to its decoder's write() and asks its end() at the end of the body. A program that replaces either acts on the request there.
import http from "node:http";
import { StringDecoder } from "node:string_decoder";

const write = StringDecoder.prototype.write, end = StringDecoder.prototype.end;
const deeds = {
  "only counts": () => {},
  "pauses the request": (req, log) => { req.pause(); setTimeout(() => { log.push("resume"); req.resume(); }, 30); },
  "takes the listener of data off": (req, log, onData) => { req.off("data", onData); req.on("data", chunk => log.push("other " + chunk)); },
  "destroys the request": req => { req.destroy(); },
  "dumps the request": req => { req._dump(); },
  "adds a listener of readable": (req, log) => { req.on("readable", () => log.push("readable")); },
  "throws": () => { throw new Error("made up"); },
};
process.on("uncaughtException", error => console.log("   uncaught: " + error.message));

for (const method of ["write", "end"]) {
  for (const where of ["on the prototype", "on the decoder"]) {
    for (const name in deeds) {
      const log = [];
      let laid;
      const isLaid = new Promise(done => (laid = done));
      const server = http.createServer((req, res) => {
        req.setEncoding("utf8");
        const onData = chunk => log.push("data " + chunk);
        req.on("data", onData);
        req.on("end", () => { log.push("end"); res.end("ok"); });
        req.on("close", () => { log.push("close"); if (!res.writableEnded) res.end("closed"); });
        setTimeout(() => {
          let calls = 0;
          const original = method === "write" ? write : end;
          const holder = where === "on the prototype" ? StringDecoder.prototype : req._readableState.decoder;
          holder[method] = function (...rest) {
            if (calls++ === 0) { log.push(method); deeds[name](req, log, onData); }
            return original.apply(this, rest);
          };
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
      StringDecoder.prototype.write = write;
      StringDecoder.prototype.end = end;
      console.log(method + " " + where + ", " + name + ": " + log.join(" | "));
      server.close();
      server.closeAllConnections();
    }
  }
}
