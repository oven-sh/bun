// Listeners of 'finish' and 'close' and the callback of end() queue ticks, and some of them throw or enable a hook. 'close' of the response and the dump of its request were queued before any of them ran, so they come ahead of those ticks on the first request of a connection as on a later one.
const http = require("node:http");
const net = require("node:net");
const { createHook } = require("node:async_hooks");

let log = [];
process.on("uncaughtException", error => log.push("uncaught " + error.message));
const say = text => () => log.push(text);
const tick = name => process.nextTick(say(name));
const fail = message => {
  throw new Error(message);
};
const watch = (emitter, name, events) => events.forEach(event => emitter.on(event, say(name + " " + event)));
const stateIn = (name, req, res) =>
  process.nextTick(() =>
    log.push(`${name} ${req.readableFlowing} ${req.readableEnded} ${req.destroyed} ${req.complete} ${res.destroyed}`),
  );
const countTicks = () => createHook({ init: (id, type) => type === "TickObject" && log.push("init") }).enable();

// Each entry: what the listener of 'finish' does, what the listener of 'close' does, and what comes before end().
const forms = {
  "nobody throws": [() => tick("tick"), () => tick("tick 2")],
  "finish throws": [() => (tick("tick"), fail("a")), () => tick("tick 2")],
  "close throws": [() => tick("tick"), () => (tick("tick 2"), fail("b"))],
  "both throw": [() => (tick("tick"), fail("a")), () => (tick("tick 2"), fail("b"))],
  "finish throws in front of a second listener": [
    () => (tick("tick"), fail("a")),
    () => {},
    (req, res) => res.on("finish", say("finish 2")),
  ],
  "a second listener of finish throws": [
    () => tick("tick"),
    () => {},
    (req, res) => res.on("finish", () => (log.push("finish 2"), tick("tick 2"), fail("c"))),
  ],
  "finish throws and queues a microtask": [() => (queueMicrotask(say("microtask")), tick("tick"), fail("a")), () => {}],
  "finish throws, a tick waits in front": [() => (tick("tick"), fail("a")), () => {}, () => tick("tick 0")],
  "finish throws, the request is watched": [
    () => (tick("tick"), fail("a")),
    () => tick("tick 2"),
    req => watch(req, "req", ["resume", "end", "close"]),
  ],
  "close throws, the request is watched": [
    () => tick("tick"),
    () => (tick("tick 2"), fail("b")),
    req => watch(req, "req", ["resume", "end", "close"]),
  ],
  "finish throws, the request is watched from there": [
    req => (watch(req, "req", ["resume", "end", "close"]), tick("tick"), fail("a")),
    () => tick("tick 2"),
  ],
  "close throws, the request is watched from finish": [
    req => (watch(req, "req", ["resume", "end", "close"]), tick("tick")),
    () => (tick("tick 2"), fail("b")),
  ],
  "close throws, the request is watched from there": [
    () => tick("tick"),
    req => (watch(req, "req", ["resume", "end", "close"]), tick("tick 2"), fail("b")),
  ],
  "nobody throws, the request is watched from finish": [
    req => (watch(req, "req", ["resume", "end", "close"]), tick("tick")),
    () => tick("tick 2"),
  ],
  "finish throws, the ticks read the state": [
    (req, res) => (stateIn("tick", req, res), fail("a")),
    (req, res) => stateIn("tick 2", req, res),
  ],
  "close throws, the ticks read the state": [
    (req, res) => stateIn("tick", req, res),
    (req, res) => (stateIn("tick 2", req, res), fail("b")),
  ],
  "finish enables a hook": [(req, res) => ((res.hook = countTicks()), tick("tick")), (req, res) => res.hook.disable()],
  "finish enables a hook and throws": [
    (req, res) => ((res.hook = countTicks()), tick("tick"), fail("a")),
    (req, res) => res.hook.disable(),
  ],
};

// How the response is ended.
const ends = {
  "end(text)": res => res.end("ok!"),
  "write(text), end()": res => {
    res.writeHead(200, { "Content-Length": 3 });
    res.write("ok!");
    res.end();
  },
  "an immediate later": res => setImmediate(() => res.end("ok!")),
  "end(text, callback)": res => res.end("ok!", () => (log.push("callback"), tick("tick of the callback"))),
  "end(text, callback that throws)": res =>
    res.end("ok!", () => (log.push("callback"), tick("tick of the callback"), fail("d"))),
  "end(text, callback that throws) with a listener of error": res => {
    res.on("error", error => (log.push("error " + error.message), tick("tick of error")));
    res.end("ok!", () => (log.push("callback"), tick("tick of the callback"), fail("d")));
  },
  "end(text, callback that throws) with a listener of error that throws": res => {
    res.on("error", error => (log.push("error " + error.message), tick("tick of error"), fail("e")));
    res.end("ok!", () => (log.push("callback"), tick("tick of the callback"), fail("d")));
  },
};

const endedInEveryWay = ["nobody throws", "finish throws", "close throws", "both throw"];

const warmUp = "GET /warm-up HTTP/1.1\r\nHost: a\r\n\r\n";
const requests = {
  GET: "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
  POST: "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi",
};

function play(form, end, method, warmUps) {
  const { promise, resolve } = Promise.withResolvers();
  log = [];
  const [onFinish, onClose, first] = forms[form];
  const server = http.createServer((req, res) => {
    if (req.url === "/warm-up") return void res.end("ok");
    res.on("finish", () => (log.push("finish"), onFinish(req, res)));
    res.on("close", () => (log.push("close"), onClose(req, res)));
    first?.(req, res);
    ends[end](res);
  });
  server.listen(0, "127.0.0.1", () => {
    const client = net.connect(server.address().port, "127.0.0.1");
    let wire = "";
    let left = warmUps;
    client.on("data", bytes => {
      wire += bytes.toString("latin1");
      if (wire.endsWith("ok!")) return void setImmediate(() => setImmediate(() => client.destroy()));
      if (left === 0 || !wire.endsWith("ok")) return;
      wire = "";
      client.write(--left > 0 ? warmUp : requests[method]);
    });
    client.on("close", () => {
      const seen = log.join(", ");
      server.close(() => resolve(seen));
      server.closeAllConnections();
    });
    client.write(left > 0 ? warmUp : requests[method]);
  });
  return promise;
}

(async () => {
  for (const form of Object.keys(forms)) {
    for (const end of endedInEveryWay.includes(form) ? Object.keys(ends) : ["end(text)"]) {
      for (const method of Object.keys(requests)) {
        for (const warmUps of [0, 1]) {
          console.log(`${form}, ${end}, ${method} behind ${warmUps}: ${await play(form, end, method, warmUps)}`);
        }
      }
    }
  }
})();
