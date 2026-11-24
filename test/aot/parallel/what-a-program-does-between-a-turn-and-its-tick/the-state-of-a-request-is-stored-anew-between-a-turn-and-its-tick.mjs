// `req._readableState = ..` by a plain store, which leaves the request a plain request: the ticks that end a body and that close the request go by what lies there now.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

const values = {
  undefined: () => undefined,
  null: () => null,
  "the state of another stream": other => other._readableState,
  "an object of the program's": () => ({ made: "up" }),
};

function run(value, moment, hasBody) {
  return new Promise(resolve => {
    const log = [];
    const other = new Readable({ read() {} });
    other.on("end", () => log.push("the other ends"));
    other.on("close", () => log.push("the other closes"));
    const server = http.createServer((req, res) => {
      const act = () => {
        log.push("deed");
        req._readableState = value(other);
      };
      req.on("data", chunk => {
        log.push("data " + chunk.length);
        if (moment === "a tick behind data") process.nextTick(act);
      });
      req.on("end", () => {
        log.push("end");
        res.end("ok");
        if (moment === "at end") act();
        if (moment === "a tick behind end") process.nextTick(act);
      });
      req.on("close", () => log.push("close"));
      setTimeout(() => {
        if (!res.writableEnded) res.end("late");
      }, 150);
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      const limit = setTimeout(() => client.destroy(), 500);
      client.write(
        hasBody
          ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\n"
          : "GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n",
      );
      if (hasBody) setTimeout(() => client.write("hello"), 20);
      client.on("data", () => {});
      client.on("error", () => {});
      client.on("close", () => {
        clearTimeout(limit);
        server.close();
        setTimeout(() => resolve(log.join(" | ") + " | the other: ended " + other.readableEnded + " closed " + other.closed), 60);
      });
    });
  });
}

let uncaught = [];
process.on("uncaughtException", error => uncaught.push(error.constructor.name));
for (const [label, value] of Object.entries(values)) {
  for (const [moment, hasBody] of [
    ["a tick behind data", true],
    ["at end", true],
    ["a tick behind end", true],
    ["at end", false],
    ["a tick behind end", false],
  ]) {
    uncaught = [];
    const row = await run(value, moment, hasBody);
    console.log(label, moment, hasBody ? "with a body" : "without a body", ":", row, "| uncaught", [...new Set(uncaught)].join());
  }
}
process.exit(0);
