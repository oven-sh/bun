// Listeners of 'finish' and 'close' and the callback of end() enter another store of an AsyncLocalStorage, and some of them throw. 'close' of the response and what the dump of its request emits run in the store that end() was called in, on the first request of a connection as on a later one.
const http = require("node:http");
const net = require("node:net");
const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();
let log = [];
const say = text => log.push(`${text} in ${storage.getStore()}`);
process.on("uncaughtException", error => say("uncaught " + error.message));
const tick = name => process.nextTick(() => say(name));
const fail = message => {
  throw new Error(message);
};
const watch = req => ["resume", "end", "close"].forEach(event => req.on(event, () => say("req " + event)));

// Each entry: what the listener of 'finish' does, what the listener of 'close' does, what the callback of end() does.
const forms = {
  "nobody enters": [() => tick("tick"), () => tick("tick 2")],
  "finish enters": [() => (storage.enterWith("finish"), tick("tick")), () => tick("tick 2")],
  "finish enters and throws": [() => (storage.enterWith("finish"), tick("tick"), fail("a")), () => tick("tick 2")],
  "finish throws": [() => (tick("tick"), fail("a")), () => tick("tick 2")],
  "close enters": [() => tick("tick"), () => (storage.enterWith("close"), tick("tick 2"))],
  "close enters and throws": [() => tick("tick"), () => (storage.enterWith("close"), tick("tick 2"), fail("b"))],
  "both enter": [() => (storage.enterWith("finish"), tick("tick")), () => (storage.enterWith("close"), tick("tick 2"))],
  "both enter and throw": [
    () => (storage.enterWith("finish"), tick("tick"), fail("a")),
    () => (storage.enterWith("close"), tick("tick 2"), fail("b")),
  ],
  "the callback enters": [
    () => tick("tick"),
    () => tick("tick 2"),
    () => (storage.enterWith("callback"), tick("tick 3")),
  ],
  "the callback enters and throws": [
    () => tick("tick"),
    () => tick("tick 2"),
    () => (storage.enterWith("callback"), tick("tick 3"), fail("c")),
  ],
  "finish leaves the store": [() => (storage.enterWith(undefined), tick("tick")), () => tick("tick 2")],
  "finish runs in another store": [() => storage.run("finish", () => tick("tick")), () => tick("tick 2")],
};

const warmUp = "GET /warm-up HTTP/1.1\r\nHost: a\r\n\r\n";
const requests = {
  GET: "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
  POST: "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi",
};

function play(form, watches, method, warmUps) {
  const { promise, resolve } = Promise.withResolvers();
  log = [];
  const [onFinish, onClose, callback] = forms[form];
  const server = http.createServer((req, res) => {
    if (req.url === "/warm-up") return void res.end("ok");
    if (watches === "watched") watch(req);
    res.on("finish", () => (say("finish"), watches === "watched from finish" && watch(req), onFinish()));
    res.on("close", () => (say("close"), watches === "watched from close" && watch(req), onClose()));
    storage.run("end", () => (callback ? res.end("ok!", () => (say("callback"), callback())) : res.end("ok!")));
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
    for (const watches of ["unwatched", "watched", "watched from finish", "watched from close"]) {
      for (const method of Object.keys(requests)) {
        for (const warmUps of [0, 1]) {
          console.log(
            `${form}, ${watches}, ${method} behind ${warmUps}: ${await play(form, watches, method, warmUps)}`,
          );
        }
      }
    }
  }
})();
