import http from "node:http";
import { finished } from "node:stream";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
function serve(handle) {
  return new Promise(resolve => {
    const server = http.createServer(handle);
    server.listen(0, "127.0.0.1", async () => {
      let body;
      try {
        body = await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text();
      } catch (error) {
        body = "failed: " + error.name;
      }
      await settle();
      server.close(() => resolve(body));
    });
  });
}
const turns = Number(process.argv[2] ?? 2);
for (let turn = 0; turn < turns; turn++) {
  for (const name of ["writableFinished", "closed", "finished", "_closed", "_sent100"]) {
    const body = await serve((req, res) => {
      const value = res[name];
      let asks = 0;
      Object.defineProperty(res, name, {
        configurable: true,
        get() {
          asks++;
          res.pipe = undefined;
          return value;
        },
        set() {},
      });
      finished(res, error => lines.push(name + ": later " + (error ? (error.code ?? error.name) : "ended")));
      lines.push(name + ": asked " + asks + " . pipe " + typeof res.pipe);
      delete res[name];
      delete res.pipe;
      res.end("over");
    });
    lines.push("body " + body);
  }
}
console.log(lines.join("\n"));
