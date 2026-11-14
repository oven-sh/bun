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
  for (const takes of [false, true]) {
    const body = await serve((req, res) => {
      res.end("over");
      let asks = 0;
      Object.defineProperty(res.socket, "writableLength", {
        configurable: true,
        get() {
          asks++;
          if (takes) {
            res.pipe = undefined;
            res.write = undefined;
          }
          return 0;
        },
      });
      let said = "nothing yet";
      try {
        finished(res, error => {
          said = error ? (error.code ?? error.name) : "ended";
          lines.push((takes ? "takes: " : "leaves: ") + "later " + said);
        });
      } catch (error) {
        said = "threw " + error.code;
      }
      lines.push((takes ? "takes: " : "leaves: ") + "at once " + said + " . asked " + asks);
      delete res.socket.writableLength;
    });
    lines.push("body " + body);
  }
}
console.log(lines.join("\n"));
