// `req._events` is an object of its own. An accessor of the program's on it runs wherever the library looks whether somebody listens, and what it does to the request holds.
import http from "node:http";
import net from "node:net";

const deeds = {
  "pauses for a while"(req, log) {
    req.pause();
    setTimeout(() => {
      log.push("resumed");
      req.resume();
    }, 30);
  },
  "destroys the request"(req) {
    req.destroy();
  },
  "sets an encoding"(req) {
    req.setEncoding("latin1");
  },
  "does nothing"() {},
};

function run(name, deed, armsAt, hasBody) {
  return new Promise(resolve => {
    const log = [];
    const server = http.createServer((req, res) => {
      let isArmed = armsAt === "at once";
      req.on("data", chunk => {
        log.push(`data ${typeof chunk} ${chunk.length}`);
        if (armsAt === "behind data") isArmed = true;
      });
      req.on("end", () => {
        log.push("end");
        res.end("ok");
      });
      req.on("close", () => {
        log.push("close");
        if (!res.writableEnded) res.end("closed");
      });
      const held = req._events[name];
      Object.defineProperty(req._events, name, {
        configurable: true,
        enumerable: true,
        get() {
          if (isArmed) {
            isArmed = false;
            log.push("deed");
            deed(req, log);
          }
          return held;
        },
        set() {},
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      const limit = setTimeout(() => client.destroy(), 500);
      client.write(
        hasBody
          ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\n"
          : "GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n",
      );
      if (hasBody) setTimeout(() => client.write("hello"), 15);
      client.on("data", () => {});
      client.on("error", () => {});
      client.on("close", () => {
        clearTimeout(limit);
        server.close();
        setTimeout(() => resolve(log.join(" | ")), 50);
      });
    });
  });
}

let uncaught = [];
process.on("uncaughtException", error => uncaught.push(error.constructor.name));
for (const name of ["resume", "readable", "pause"]) {
  for (const [label, deed] of Object.entries(deeds)) {
    for (const [armsAt, hasBody] of [
      ["at once", true],
      ["behind data", true],
      ["at once", false],
    ]) {
      uncaught = [];
      const row = await run(name, deed, armsAt, hasBody);
      console.log(name, ".", label, ".", armsAt, hasBody ? "with a body" : "without a body", ":", row, "| uncaught", [...new Set(uncaught)].join());
    }
  }
}
process.exit(0);
