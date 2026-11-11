// The listener of `end` queues a tick, which runs in front of the ticks that close the request. What it does to the request holds for them.
import http from "node:http";
import net from "node:net";

const deeds = {
  nothing() {},
  "a listener of close"(req, log) {
    req.on("close", () => log.push("late close"));
  },
  "a writable state of the program's own"(req, log) {
    const key = Object.getOwnPropertySymbols(req._readableState).find(it => typeof req._readableState[it] === "number");
    const state = { [key]: 1 << 3 };
    req._writableState = state;
    setTimeout(() => log.push("writable word " + state[key]), 40);
  },
  "listenerCount is the program's own"(req, log) {
    req.listenerCount = function (name) {
      log.push("listenerCount " + name);
      return 0;
    };
  },
  "emit is the program's own"(req, log) {
    const emit = req.emit;
    req.emit = function (name, ...rest) {
      log.push("emit " + String(name));
      return emit.call(this, name, ...rest);
    };
  },
  "the listeners come from an accessor"(req, log) {
    const events = { __proto__: null, close: () => log.push("close of the accessor") };
    Object.defineProperty(req, "_events", { configurable: true, get: () => events, set() {} });
  },
  "another prototype with an emit of its own"(req, log) {
    const above = Object.getPrototypeOf(req);
    Object.setPrototypeOf(req, {
      __proto__: above,
      emit(name, ...rest) {
        log.push("emit above " + String(name));
        return above.emit.call(this, name, ...rest);
      },
    });
  },
};

function run(deed, hasBody, when) {
  return new Promise(resolve => {
    const log = [];
    const server = http.createServer((req, res) => {
      const act = () => {
        log.push("deed");
        deed(req, log);
      };
      req.on("end", () => {
        log.push("end");
        if (when === "at end") act();
        else process.nextTick(act);
        res.end("ok");
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
        setTimeout(() => resolve(log.join(" | ")), 60);
      });
    });
  });
}

process.on("uncaughtException", error => console.log("uncaught", error.constructor.name));
for (const [label, deed] of Object.entries(deeds)) {
  for (const hasBody of [false, true]) {
    for (const when of ["at end", "a tick behind end"]) {
      console.log(label, hasBody ? "with a body" : "without a body", when, ":", await run(deed, hasBody, when));
    }
  }
}
process.exit(0);
