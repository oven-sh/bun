// finished() on what only passes for a stream, on streams whose methods and accessors are the program's, under signals, and on a request and a response of node:http: every call and every read that the program can see.
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import http from "node:http";
import { Duplex, Readable, Writable, finished } from "node:stream";
import { finished as finishedPromise } from "node:stream/promises";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));
const name = key => (typeof key === "symbol" ? key.toString() : key);
const told = title => function (...args) { say("  " + title, args.length, args[0]?.code ?? args[0]?.name ?? String(args[0])); };

say("== what is no stream");
for (const value of [undefined, null, 5, "text", {}, [], () => {}, new EventEmitter(), { on() {} }, { pipe() {} }, { write() {} }]) {
  try {
    finished(value, () => {});
    say("  taken");
  } catch (error) {
    say("  refused", error.code);
  }
}
say("== arguments");
for (const args of [[new Readable()], [new Readable(), 5], [new Readable(), {}, 5], [new Readable(), 5, () => {}], [new Readable(), null, () => {}], [new Readable(), undefined, () => {}], [new Readable(), { signal: 5 }, () => {}]]) {
  try {
    say("  taken", typeof finished(...args));
  } catch (error) {
    say("  refused", error.code);
  }
}

class Told extends EventEmitter {
  on(type, listener) {
    say("    on", name(type), listener.name);
    return super.on(type, listener);
  }
  removeListener(type, listener) {
    say("    removeListener", name(type), listener.name);
    return super.removeListener(type, listener);
  }
}
say("== old streams");
{
  const shapes = {
    "it pipes": { pipe() {} },
    "it writes": { write() {}, writable: true },
    "it does both": { pipe() {}, write() {}, readable: true, writable: true },
    "it looks like a request of a client": { setHeader() {}, abort() {}, write() {} },
    "the same with req": { setHeader() {}, abort() {}, write() {}, req: new Told() },
    "it knows aborted": { pipe() {}, aborted: false },
    "it says closed": { pipe() {}, closed: true },
    "it says destroyed": { pipe() {}, readable: true, destroyed: true },
    "it looks like a message that has gone out and is closed": { write() {}, _closed: true, _defaultKeepAlive: true, _removedConnection: false, _removedContLen: false },
    "the same, still open": { write() {}, _closed: false, _defaultKeepAlive: true, _removedConnection: false, _removedContLen: false },
    "the same with _sent100": { write() {}, _closed: false, _defaultKeepAlive: true, _removedConnection: false, _removedContLen: false, _sent100: false },
  };
  for (const shape in shapes) {
    say(" ", shape);
    const stream = Object.assign(new Told(), shapes[shape]);
    const cleanup = finished(stream, told("answered"));
    for (const event of ["finish", "end", "complete", "abort", "aborted", "close"]) stream.emit(event);
    await tick();
    cleanup();
  }
}

say("== states of another implementation");
{
  const states = {
    "a readable state of its own": { _readableState: { readable: true, ended: false, endEmitted: false, autoDestroy: true, emitClose: true, closed: false } },
    "that has ended": { _readableState: { ended: true, endEmitted: true, length: 0 } },
    "that has failed": { _readableState: { errored: new Error("foreign"), errorEmitted: true } },
    "a writable state of its own": { write() {}, _writableState: { writable: true, ended: false, finished: false, pendingcb: 0 } },
    "that has finished": { write() {}, _writableState: { ended: true, finished: true, length: 0 } },
    "the library's readable state in a foreign stream": { _readableState: new Readable()._readableState },
    "the library's readable state where the writable one belongs": { write() {}, _writableState: new Readable()._readableState },
    "states that are no objects": { _readableState: 1, _writableState: "w" },
  };
  for (const title in states) {
    say(" ", title);
    const stream = Object.assign(new Told(), { pipe() {} }, states[title]);
    try {
      const cleanup = finished(stream, told("answered"));
      await tick();
      stream.emit("end");
      stream.emit("close");
      await tick();
      cleanup();
    } catch (error) {
      say("  threw", error.constructor.name);
    }
  }
}

say("== a readable with req and aborted, as a response that a client gets");
for (const aborted of [false, true]) {
  const stream = Object.assign(new Readable({ read() {} }), { req: new EventEmitter(), aborted });
  const cleanup = finished(stream, told("answered"));
  say("  listeners", stream.eventNames().map(name).join());
  await tick();
  cleanup();
}

say("== one side is through and the other is awaited");
{
  const make = more => new Duplex({ autoDestroy: false, read() {}, write(chunk, encoding, done) { done(); }, ...more });
  const endReadableSide = stream => { stream.push(null); stream.resume(); };
  const turns = {
    "ended, nothing left to write, and final() never comes back": [make({ final() {} }), stream => stream.end(), endReadableSide],
    "ended, final() never comes back, and it is marked as failed": [make({ final() {} }), stream => stream.end(), endReadableSide, stream => { stream._writableState.errored = new Error("marked"); }],
    "finished, then marked as failed": [make(), stream => stream.end(), endReadableSide, stream => { stream._writableState.errored = new Error("marked"); }],
    "read to its end, then marked as failed": [make(), endReadableSide, stream => stream.end(), stream => { stream._readableState.errored = new Error("marked"); }],
    "the readable side alone has emitted an error": [make(), stream => { stream._readableState.errored = new Error("marked"); stream._readableState.errorEmitted = true; }, () => {}],
    "the writable side alone has emitted an error": [make(), stream => { stream._writableState.errored = new Error("marked"); stream._writableState.errorEmitted = true; }, () => {}],
  };
  for (const title in turns) {
    const [stream, first, second, mark] = turns[title];
    say(" ", title);
    stream.on("error", () => {});
    first(stream);
    if (mark) {
      await tick();
      await tick();
      mark(stream);
    }
    finished(stream, told("answered"));
    await tick();
    say("  then");
    second(stream);
    await tick();
    await tick();
  }
}

say("== the library's states in a stream that says nothing of itself");
{
  const closedReadable = new Readable({ read() {} });
  closedReadable.destroy();
  const closedWritable = new Writable();
  closedWritable.destroy();
  await tick();
  const states = {
    "a readable state that is closed": { pipe() {}, _readableState: closedReadable._readableState },
    "a writable state that is closed": { write() {}, _writableState: closedWritable._writableState },
    "an open writable state beside a closed readable one": { pipe() {}, write() {}, _writableState: new Writable()._writableState, _readableState: closedReadable._readableState },
  };
  for (const title in states) {
    say(" ", title);
    const stream = Object.assign(new EventEmitter(), states[title]);
    finished(stream, told("answered"));
    say("  listeners", stream.eventNames().map(name).join() || "none");
    await tick();
  }
}

say("== heirs that tell");
for (const Base of [Readable, Writable, Duplex]) {
  class Heir extends Base {
    _read() {}
    _write(chunk, encoding, done) { done(); }
    on(type, listener) {
      say("    on", name(type), listener.name);
      return super.on(type, listener);
    }
    removeListener(type, listener) {
      say("    removeListener", name(type), listener.name);
      return super.removeListener(type, listener);
    }
    get destroyed() {
      say("    destroyed is read");
      return super.destroyed;
    }
    get closed() {
      say("    closed is read");
      return super.closed;
    }
  }
  say(" ", Base.name);
  const stream = new Heir();
  const cleanup = finished(stream, told("answered"));
  stream.destroy();
  await tick();
  cleanup();
}

say("== an heir that says it has finished");
{
  class Done extends Writable {
    get writableFinished() {
      return true;
    }
  }
  const stream = new Done();
  finished(stream, { readable: false }, told("answered"));
  say("  listeners", stream.eventNames().map(name).join() || "none");
  await tick();
}

say("== on() laid on the stream itself, and on the prototypes");
{
  const stream = new Readable({ read() {} });
  stream.on = function (type, listener) {
    say("    its own on", name(type));
    return Readable.prototype.on.call(this, type, listener);
  };
  finished(stream, told("answered"))();
  const original = Readable.prototype.on;
  Readable.prototype.on = function (type, listener) {
    say("    the on of all readables", name(type));
    return original.call(this, type, listener);
  };
  finished(new Readable({ read() {} }), told("answered"))();
  Readable.prototype.on = original;
  const ofEmitters = EventEmitter.prototype.on;
  EventEmitter.prototype.on = function (type, listener) {
    say("    the on of all emitters", name(type));
    return ofEmitters.call(this, type, listener);
  };
  finished(new Readable({ read() {} }), told("answered"))();
  finished(new Writable(), told("answered"))();
  EventEmitter.prototype.on = ofEmitters;
  finished(new Readable({ read() {} }), told("answered"))();
}

say("== newListener and removeListener are heard");
{
  const stream = new Duplex({ read() {}, write(chunk, encoding, done) { done(); } });
  stream.on("newListener", (type, listener) => say("    new", name(type), listener.name));
  stream.on("removeListener", (type, listener) => say("    removed", name(type), listener.name));
  finished(stream, told("answered"))();
}

say("== a proxy");
{
  const reads = [];
  const stream = new Proxy(new Readable({ read() {} }), {
    get(target, key, receiver) {
      reads.push(name(key));
      return Reflect.get(target, key, target);
    },
  });
  finished(stream, told("answered"))();
  say("  ", reads.join());
}
say("== options behind a proxy, and through accessors");
{
  const reads = [];
  finished(new Readable({ read() {} }), new Proxy({ writable: false }, { get(target, key) { reads.push(name(key)); return target[key]; } }), told("answered"))();
  say("  ", reads.join());
}

say("== signals");
{
  const aborted = AbortSignal.abort(new Error("already"));
  const late = new Readable({ read() {} });
  finished(late, { signal: aborted }, told("aborted before"));
  say("  listeners", late.eventNames().map(name).join() || "none");
  process.nextTick(() => say("  a tick"));
  queueMicrotask(() => say("  a job"));
  await tick();
  const controller = new AbortController();
  const stream = new Readable({ read() {} });
  finished(stream, { signal: controller.signal }, told("aborted behind"));
  say("  listeners", stream.eventNames().map(name).join());
  controller.abort();
  await tick();
  say("  listeners", stream.eventNames().map(name).join() || "none");
  const unused = new AbortController();
  const ended = new Readable({ read() {} });
  finished(ended, { signal: unused.signal }, told("ended under a signal"));
  ended.push(null);
  ended.resume();
  await tick();
  await tick();
  unused.abort();
  await tick();
  await finishedPromise(new Readable({ read() {} }), { signal: AbortSignal.abort() }).catch(error => say("  the promise", error.name));
  const kept = new Readable({ read() {} });
  const promise = finishedPromise(kept, { cleanup: true });
  kept.destroy();
  await promise.catch(error => say("  the promise", error.code));
  say("  cleaned", kept.eventNames().map(name).join() || "none");
}

say("== contexts");
{
  const storage = new AsyncLocalStorage();
  const stream = new Readable({ read() {} });
  storage.run("of the caller", () => finished(stream, () => say("  answered in", storage.getStore())));
  storage.run("of the destroyer", () => stream.destroy());
  await tick();
}

say("== a callback that throws, and one that is called once");
{
  const stream = new Readable({ read() {} });
  let times = 0;
  finished(stream, () => say("  called", ++times));
  stream.emit("close");
  stream.emit("close");
  stream.emit("end");
  stream.destroy();
  await tick();
}

say("== a request and a response");
await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    finished(req, told("the request"));
    finished(res, told("the response"));
    finished(req.socket, { readable: false }, told("the socket"));
    say("  on the request", req.eventNames().map(name).join(), "| on the response", res.eventNames().map(name).join());
    res.on("finish", () => {
      finished(res, told("the response, asked at its finish"));
      say("  at its finish", res.eventNames().map(name).join());
    });
    res.on("close", () => {
      finished(res, told("the response, asked at its close"));
      say("  at its close", res.eventNames().map(name).join());
    });
    req.resume();
    res.end("ok");
  });
  server.listen(0, "127.0.0.1", () => {
    const request = http.get({ port: server.address().port, host: "127.0.0.1", agent: false }, response => {
      finished(response, told("what the client got"));
      response.resume();
      response.on("close", () => server.close(() => setImmediate(resolve)));
    });
    finished(request, told("what the client sent"));
    say("  on what the client sends", request.eventNames().map(name).join());
  });
});

console.log(log.join("\n"));
