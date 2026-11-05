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
    hostHeaderAsked = 0,
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
  // The road that reads everything asks the server for this name once a request. The short one never does: the line below says which was taken.
  Object.defineProperty(server, "requireHostHeader", {
    configurable: true,
    get() {
      hostHeaderAsked++;
      return true;
    },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = net.connect(server.address().port, "127.0.0.1");
  await new Promise(resolve => client.once("connect", resolve));
  client.on("data", () => {});
  const ask = async (label, name, way) => {
    called = [];
    wasRead = false;
    hostHeaderAsked = 0;
    const seen = await new Promise(resolve => {
      finish = resolve;
      client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nqq");
      if (name !== null) lay(name, way);
    });
    lines.push(`${label}: ${seen}`);
    lines.push(`road: ${label}: ${hostHeaderAsked === 0 ? "short" : "full"}`);
  };
  await ask("nothing is laid", null, "");
  await ask("nothing is laid, once more", null, "");
  for (const name of Object.keys(values)) {
    for (const way of ["a value", "an accessor"]) await ask(`${name} . ${way}`, name, way);
  }
  await ask("nothing is laid again", null, "");
  client.destroy();
  await new Promise(resolve => server.close(resolve));
  console.log(lines.join("\n"));
});
