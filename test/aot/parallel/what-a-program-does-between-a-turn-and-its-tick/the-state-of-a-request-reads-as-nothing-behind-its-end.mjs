// Behind `end` the program makes `_readableState` an accessor that answers undefined, null or another state. The ticks that close the request take what they read.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

const answers = {
  undefined: () => undefined,
  null: () => null,
  "the state of another stream": () => other._readableState,
};
let other;

function run(answer, hasBody, when) {
  return new Promise(resolve => {
    const log = [];
    other = new Readable({ read() {} });
    const server = http.createServer((req, res) => {
      const act = () => {
        log.push("deed");
        Object.defineProperty(req, "_readableState", { configurable: true, get: answer, set() {} });
      };
      req.on("close", () => log.push("close"));
      req.on("end", () => {
        log.push("end");
        res.end("ok");
        if (when === "at end") act();
        else process.nextTick(act);
      });
      req.resume();
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      const limit = setTimeout(() => client.destroy(), 500);
      client.write(
        hasBody
          ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello"
          : "GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n",
      );
      client.on("data", () => {});
      client.on("error", () => {});
      client.on("close", () => {
        clearTimeout(limit);
        server.close();
        setTimeout(() => resolve(log.join(" | ") + " | the other is closed " + other.closed), 60);
      });
    });
  });
}

let uncaught = [];
process.on("uncaughtException", error => uncaught.push(error.constructor.name));
for (const [label, answer] of Object.entries(answers)) {
  for (const hasBody of [false, true]) {
    for (const when of ["at end", "a tick behind end"]) {
      uncaught = [];
      const row = await run(answer, hasBody, when);
      console.log(label, hasBody ? "with a body" : "without a body", when, ":", row, "| uncaught", [...new Set(uncaught)].join());
    }
  }
}
process.exit(0);
