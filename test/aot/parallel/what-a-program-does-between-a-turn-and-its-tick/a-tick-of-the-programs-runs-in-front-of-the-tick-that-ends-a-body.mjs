// The listener of `data` queues a tick, which runs in front of the ticks that end the body. What it does to the request or to its state holds for them.
import http from "node:http";
import net from "node:net";

const deeds = {
  nothing() {},
  "a high-water mark of zero by an accessor"(req) {
    Object.defineProperty(req._readableState, "highWaterMark", { configurable: true, get: () => 0, set() {} });
  },
  "complete is an accessor that keeps the store"(req, log) {
    let held = req.complete;
    Object.defineProperty(req, "complete", {
      configurable: true,
      get: () => held,
      set(value) {
        held = value;
        log.push("complete = " + value);
      },
    });
  },
  "push is the program's own"(req, log) {
    const push = req.push;
    req.push = function (chunk) {
      log.push("push " + chunk);
      return push.call(this, chunk);
    };
  },
  "read is the program's own"(req, log) {
    const read = req.read;
    let isTold = false;
    req.read = function (size) {
      if (!isTold) log.push("read " + size);
      isTold = true;
      return read.call(this, size);
    };
  },
  "another prototype with a push of its own"(req, log) {
    const above = Object.getPrototypeOf(req);
    Object.setPrototypeOf(req, {
      __proto__: above,
      push(chunk) {
        log.push("push above " + chunk);
        return above.push.call(this, chunk);
      },
    });
  },
  "a listener of readable"(req, log) {
    req.on("readable", () => log.push("readable"));
  },
  "the request is paused"(req, log) {
    req.pause();
    setTimeout(() => {
      log.push("resumed");
      req.resume();
    }, 20);
  },
  "the request is destroyed"(req) {
    req.destroy();
  },
  "the state is another object by an accessor"(req, log) {
    const state = req._readableState;
    let isTold = false;
    Object.defineProperty(req, "_readableState", {
      configurable: true,
      set() {},
      get() {
        if (!isTold) log.push("state read");
        isTold = true;
        return state;
      },
    });
  },
};

function run(deed, encoding) {
  return new Promise(resolve => {
    const log = [];
    const server = http.createServer((req, res) => {
      if (encoding) req.setEncoding(encoding);
      req.on("data", chunk => {
        log.push("data " + chunk.length);
        process.nextTick(() => {
          log.push("deed");
          deed(req, log);
        });
      });
      req.on("end", () => {
        log.push("end complete " + req.complete);
        res.end("ok");
      });
      req.on("close", () => {
        log.push("close");
        if (!res.writableEnded) res.end("closed");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      const limit = setTimeout(() => client.destroy(), 500);
      client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\n");
      setTimeout(() => client.write("hello"), 20);
      client.on("data", () => {});
      client.on("error", () => {});
      client.on("close", () => {
        clearTimeout(limit);
        server.close();
        setTimeout(() => resolve(log.join(" | ")), 30);
      });
    });
  });
}

process.on("uncaughtException", error => console.log("uncaught", error.constructor.name));
for (const [label, deed] of Object.entries(deeds)) {
  for (const encoding of [undefined, "utf8"]) console.log(label, encoding ?? "bytes", ":", await run(deed, encoding));
}
process.exit(0);
