const { Readable, Writable, Transform, Stream, finished } = require("node:stream");
const EventEmitter = require("node:events");
const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
const turns = count => new Promise(done => (function turn(left) { left ? setImmediate(turn, left - 1) : done(); })(count));
const ask = (name, stream) => {
  try {
    finished(stream, error => say(name, "has ended", error && error.code));
  } catch (error) {
    say(name, "is refused", error.code);
  }
};
class Heir extends Readable {
  _read() {
    this.push("x");
    this.push(null);
  }
}

(async () => {
  ask("an heir", new Heir().resume());
  const sink = new Writable({ write(chunk, encoding, done) { done(); } });
  ask("a sink", sink);
  sink.end("x");
  const through = new Transform({ transform(chunk, encoding, done) { done(null, chunk); } });
  ask("a transform", through);
  through.resume().end("x");
  const old = new Stream();
  ask("a stream of old", old);
  old.emit("end");
  old.emit("close");

  const own = new Heir();
  const on = own.on;
  own.on = function (name, listener) {
    say("its own on", name);
    return on.call(this, name, listener);
  };
  ask("an heir with its own on", own.resume());

  const looksLikeOne = Object.assign(new EventEmitter(), { pipe() {} });
  ask("an emitter that pipes", looksLikeOne);
  looksLikeOne.emit("end");
  looksLikeOne.emit("close");
  ask("an emitter", new EventEmitter());
  ask("an object", {});
  ask("nothing", null);

  const readable = new ReadableStream({ start(controller) { controller.enqueue("x"); controller.close(); } });
  ask("a readable stream of the web", readable);
  for await (const chunk of readable) say("read", chunk);
  const writable = new WritableStream({});
  ask("a writable stream of the web", writable);
  await writable.close();
  class WebHeir extends ReadableStream {}
  const heirOfWeb = new WebHeir({ start(controller) { controller.close(); } });
  ask("an heir of a stream of the web", heirOfWeb);
  for await (const chunk of heirOfWeb) say("read", chunk);
  const dressed = Object.setPrototypeOf(new ReadableStream({ start(controller) { controller.close(); } }), Heir.prototype);
  ask("a stream of the web under the prototype of an heir", dressed);
  await turns(8);
  console.log(said.join("\n"));
})();
