import { test } from "bun:test";
import http from "node:http";
import net from "node:net";

// Each name is written out: a compiled test run lets a test lay on Object.prototype only what the build has seen it lay.
const holders = {
  objectMode: [d => Object.defineProperty(Object.prototype, "objectMode", d), () => delete Object.prototype.objectMode],
  emitClose: [d => Object.defineProperty(Object.prototype, "emitClose", d), () => delete Object.prototype.emitClose],
  autoDestroy: [
    d => Object.defineProperty(Object.prototype, "autoDestroy", d),
    () => delete Object.prototype.autoDestroy,
  ],
  defaultEncoding: [
    d => Object.defineProperty(Object.prototype, "defaultEncoding", d),
    () => delete Object.prototype.defaultEncoding,
  ],
  encoding: [d => Object.defineProperty(Object.prototype, "encoding", d), () => delete Object.prototype.encoding],
  read: [d => Object.defineProperty(Object.prototype, "read", d), () => delete Object.prototype.read],
  destroy: [d => Object.defineProperty(Object.prototype, "destroy", d), () => delete Object.prototype.destroy],
  construct: [d => Object.defineProperty(Object.prototype, "construct", d), () => delete Object.prototype.construct],
  signal: [d => Object.defineProperty(Object.prototype, "signal", d), () => delete Object.prototype.signal],
  captureRejections: [
    d => Object.defineProperty(Object.prototype, "captureRejections", d),
    () => delete Object.prototype.captureRejections,
  ],
  highWaterMark: [
    d => Object.defineProperty(Object.prototype, "highWaterMark", d),
    () => delete Object.prototype.highWaterMark,
  ],
  rejectNonStandardBodyWrites: [
    d => Object.defineProperty(Object.prototype, "rejectNonStandardBodyWrites", d),
    () => delete Object.prototype.rejectNonStandardBodyWrites,
  ],
  madeUp: [d => Object.defineProperty(Object.prototype, "madeUp", d), () => delete Object.prototype.madeUp],
};
let called = [];
const values = {
  objectMode: () => true,
  emitClose: () => false,
  autoDestroy: () => false,
  defaultEncoding: () => "latin1",
  encoding: () => "hex",
  read: () =>
    function (size) {
      called.push("read");
      return http.IncomingMessage.prototype._read.call(this, size);
    },
  destroy: () =>
    function (error, callback) {
      called.push("destroy");
      return http.IncomingMessage.prototype._destroy.call(this, error, callback);
    },
  construct: () =>
    function (callback) {
      called.push("construct");
      callback();
    },
  signal: () => new AbortController().signal,
  captureRejections: () => true,
  highWaterMark: () => 3,
  rejectNonStandardBodyWrites: () => true,
  madeUp: () => 1,
};

test("what a request and a response are while a name lies on Object.prototype", async () => {
  const lines = [];
  let laid = null,
    wasRead = false,
    whoAsked = "nobody",
    finish;
  const lay = (name, way) => {
    const value = values[name]();
    laid = name;
    if (way === "a value") holders[name][0]({ configurable: true, writable: true, enumerable: false, value });
    else {
      holders[name][0]({
        configurable: true,
        get() {
          wasRead = true;
          return value;
        },
        set(next) {
          Object.defineProperty(this, name, { configurable: true, writable: true, enumerable: true, value: next });
        },
      });
    }
  };
  const takeAway = () => {
    if (laid !== null) holders[laid][1]();
    laid = null;
  };
  const server = http.createServer((req, res) => {
    // Each road calls the listener from its own place in the library. Who called says which road was taken. Nothing is laid on the server: its doors would hear it.
    whoAsked = new Error().stack.split("\n")[2] ?? "";
    takeAway();
    const state = req._readableState;
    const seen = [
      `read at all ${wasRead}`,
      `request: objectMode ${req.readableObjectMode} mark ${req.readableHighWaterMark} emitClose ${state.emitClose} autoDestroy ${state.autoDestroy} defaultEncoding ${state.defaultEncoding} encoding ${req.readableEncoding}`,
      `own ${["_read", "_destroy", "_construct", "emit"].filter(name => Object.hasOwn(req, name)).join() || "none"}`,
      `response: mark ${res.writableHighWaterMark} own ${Object.hasOwn(res, "emit") ? "emit" : "none"}`,
    ];
    const chunks = [];
    req.on("data", chunk => chunks.push(typeof chunk === "string" ? `text ${chunk}` : `bytes ${chunk.length}`));
    req.on("close", () => seen.push("request closes"));
    req.on("end", () => {
      seen.push(`chunks ${chunks.join()}`);
      res.end("k");
      setImmediate(() =>
        setImmediate(() => {
          seen.push(`destroyed ${req.destroyed}`, `called ${called.join() || "nothing"}`);
          finish(seen.join(" . "));
        }),
      );
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = net.connect(server.address().port, "127.0.0.1");
  await new Promise(resolve => client.once("connect", resolve));
  client.on("data", () => {});
  const askers = [];
  const ask = async (label, name, way) => {
    called = [];
    wasRead = false;
    whoAsked = "nobody";
    const seen = await new Promise(resolve => {
      finish = resolve;
      client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nqq");
      if (name !== null) lay(name, way);
    });
    lines.push(`${label}: ${seen}`);
    askers.push([label, whoAsked]);
  };
  await ask("nothing is laid", null, "");
  await ask("nothing is laid, once more", null, "");
  for (const name of Object.keys(values)) {
    for (const way of ["a value", "an accessor"]) await ask(`${name} . ${way}`, name, way);
  }
  await ask("nothing is laid again", null, "");
  client.destroy();
  await new Promise(resolve => server.close(resolve));
  // Once a name was laid on Object.prototype the short road is taken no more: the last request went the road that reads everything.
  const full = askers.at(-1)[1];
  for (const [label, asker] of askers) lines.push(`road: ${label}: ${asker === full ? "full" : "short"}`);
  console.log(lines.join("\n"));
});
