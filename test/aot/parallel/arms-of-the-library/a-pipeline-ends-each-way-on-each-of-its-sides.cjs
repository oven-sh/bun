const { Readable, Writable, Transform, PassThrough, pipeline } = require("node:stream");
const { pipeline: promised } = require("node:stream/promises");
const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
const turns = count =>
  new Promise(done =>
    (function turn(left) {
      left ? setImmediate(turn, left - 1) : done();
    })(count),
  );
const source = list => Readable.from(list);
const sink = name =>
  new Writable({
    write(chunk, encoding, done) {
      say(name, "takes", chunk);
      done();
    },
  });
const through = () =>
  new Transform({
    transform(chunk, encoding, done) {
      done(null, String(chunk).toUpperCase());
    },
  });
const ended = name => error => say(name, "has ended", error && (error.code || error.message));
const listeners = (name, ...streams) =>
  say(
    name,
    "is heard by",
    streams.map(stream => ["error", "end", "finish", "close"].map(event => stream.listenerCount(event)).join(" ")).join(" | "),
  );

(async () => {
  const two = [source(["a", "b"]), sink("two")];
  pipeline(...two, ended("two"));
  listeners("two", ...two);
  await turns(8);
  listeners("two", ...two);
  const four = [source(["c"]), through(), new PassThrough(), sink("four")];
  pipeline(...four, ended("four"));
  listeners("four", ...four);
  await turns(10);
  listeners("four", ...four);

  const failing = new Readable({
    read() {
      this.destroy(new Error("the source fails"));
    },
  });
  pipeline(failing, through(), sink("a failing source"), ended("a failing source"));
  await turns(8);

  const refusing = new Writable({
    write(chunk, encoding, done) {
      done(new Error("the sink fails"));
    },
  });
  pipeline(source(["d"]), refusing, ended("a failing sink"));
  await turns(8);

  const cut = new Readable({ read() {} });
  pipeline(cut, sink("cut short"), ended("cut short"));
  cut.push("e");
  await turns(4);
  cut.destroy();
  await turns(6);

  const middle = through();
  pipeline(new Readable({ read() {} }), middle, sink("the middle goes"), ended("the middle goes"));
  await turns(2);
  middle.destroy();
  await turns(6);

  const gone = sink("a sink that is gone");
  gone.destroy();
  try {
    pipeline(source(["f"]), gone, ended("a sink that is gone"));
  } catch (error) {
    say("a sink that is gone is refused", error.code);
  }
  await turns(6);

  const over = source([]);
  over.resume();
  await turns(4);
  pipeline(over, sink("a source that is over"), ended("a source that is over"));
  await turns(6);

  const controller = new AbortController();
  promised(new Readable({ read() {} }), sink("aborted"), { signal: controller.signal }).then(ended("aborted"), ended("aborted"));
  await turns(2);
  controller.abort();
  await turns(6);

  const kept = sink("kept open");
  promised(source(["g"]), kept, { end: false }).then(ended("kept open"), ended("kept open"));
  await turns(8);
  say("kept open is ended:", kept.writableEnded);
  console.log(said.join("\n"));
})();
