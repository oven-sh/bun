const { EventEmitter } = require("node:events");
const { Duplex, PassThrough, Readable, Transform, Writable, finished, isDisturbed, isReadable, pipeline } = require("node:stream");
let said = [];
const say = (...words) => said.push(words.map(String).join(" "));
const label = error => (error ? error.code || error.name : "no error");
const turns = async count => {
  for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done));
};
const makers = {
  Readable: (Class = Readable) => {
    let left = 3;
    return new Class({
      read() {
        this.push(left-- ? "chunk " + left : null);
      },
    });
  },
  Writable: (Class = Writable) =>
    new Class({
      write(chunk, encoding, done) {
        say("wrote", chunk);
        done();
      },
    }),
  Duplex: (Class = Duplex) =>
    new Class({
      read() {
        this.push(null);
      },
      write(chunk, encoding, done) {
        say("wrote", chunk);
        done();
      },
    }),
  Transform: (Class = Transform) =>
    new Class({
      transform(chunk, encoding, done) {
        done(null, String(chunk).toUpperCase());
      },
    }),
  PassThrough: (Class = PassThrough) => new Class(),
};
const classes = { Readable, Writable, Duplex, Transform, PassThrough };
const uses = {
  finished(stream, kind) {
    finished(stream, error => say("finished", label(error)));
    say(stream.eventNames().map(name => String(name) + stream.listenerCount(name)));
    if (kind !== "Readable") stream.end("last");
    if (kind !== "Writable") stream.resume();
  },
  pipeline(stream, kind) {
    const done = error => say("done", label(error));
    if (kind === "Readable") pipeline(stream, makers.Writable(), done);
    else if (kind === "Writable") pipeline(makers.Readable(), stream, done);
    else pipeline(makers.Readable(), stream, makers.Writable(), done);
  },
  pipe(stream, kind) {
    if (kind === "Writable") makers.Readable().pipe(stream);
    else {
      stream.pipe(makers.Writable());
      if (kind !== "Readable") stream.end("x");
    }
  },
  ask(stream) {
    say(isReadable(stream), isDisturbed(stream), ...Object.values(classes).map(Class => stream instanceof Class));
  },
};
const round = async (name, run) => {
  said = [];
  try {
    await run();
    await turns(8);
  } catch (error) {
    say("thrown", label(error));
  }
  console.log(name + ": " + said.join(", "));
};
process.on("uncaughtException", error => say("uncaught", label(error)));

(async () => {
  for (const kind in classes) {
    for (const use in uses) {
      await round(`${kind} ${use}`, () => uses[use](makers[kind](), kind));
      for (const name of ["destroyed", "writable", "readable", "closed", "_readableState", "_writableState", "writableEnded", "writableFinished"]) {
        await round(`${kind} ${use}, an accessor ${name} of its own`, () => {
          const stream = makers[kind]();
          let held = stream[name];
          Object.defineProperty(stream, name, {
            configurable: true,
            get() {
              say("get", name);
              return held;
            },
            set(value) {
              say("set", name);
              held = value;
            },
          });
          uses[use](stream, kind);
        });
      }
      await round(`${kind} ${use}, marked as destroyed by an accessor`, () => {
        const stream = makers[kind]();
        Object.defineProperty(stream, Symbol.for("nodejs.stream.destroyed"), {
          get() {
            say("get destroyed");
            if (stream._writableState) stream._writableState = undefined;
            return false;
          },
        });
        uses[use](stream, kind);
      });
      for (const name of ["on", "pipe", "write", "end", "destroy"]) {
        await round(`${kind} ${use}, ${name} of a class below`, () => {
          const Below = class extends classes[kind] {
            [name](...values) {
              say(name);
              return super[name]?.(...values);
            }
          };
          uses[use](makers[kind](Below), kind);
        });
        const holder = kind === "Readable" ? Readable.prototype : kind === "Writable" ? Writable.prototype : Duplex.prototype;
        const method = holder[name];
        if (!method) continue;
        await round(`${kind} ${use}, ${name} of the prototype replaced`, () => {
          const held = Object.getOwnPropertyDescriptor(holder, name);
          let watched;
          holder[name] = function (...values) {
            if (this === watched) say(name);
            return method.apply(this, values);
          };
          watched = makers[kind]();
          uses[use](watched, kind);
          setImmediate(() => {
            delete holder[name];
            if (held) Object.defineProperty(holder, name, held);
          });
        });
      }
      for (const how of ["freeze", "seal"]) await round(`${kind} ${use}, ${how}`, () => uses[use](Object[how](makers[kind]()), kind));
      for (const how of ["ended", "destroyed", "failed"]) {
        await round(`${kind} ${use}, ${how}`, async () => {
          const stream = makers[kind]();
          stream.on("error", error => say("error", label(error)));
          if (how === "ended") kind === "Readable" ? stream.resume() : stream.end();
          else stream.destroy(how === "failed" ? new Error("failed") : undefined);
          await turns(3);
          uses[use](stream, kind);
        });
      }
    }
    await round(`${kind} without new`, () => {
      const stream = classes[kind]();
      say(stream.constructor.name, stream instanceof classes[kind], Object.keys(stream));
    });
    await round(`${kind} called on an object`, () => say(Object.keys(classes[kind].call({ own: 1 }, {}) ?? {})));
    await round(`${kind} called again`, () => {
      const stream = new classes[kind]();
      stream.on("x", () => {});
      classes[kind].call(stream, { captureRejections: true });
      say(Object.keys(stream), stream._eventsCount, stream.listenerCount("x"));
    });
    await round(`${kind} under another new.target`, () => {
      class Other extends EventEmitter {}
      const stream = Reflect.construct(classes[kind], [{}], Other);
      say(stream instanceof Other, stream instanceof classes[kind], Object.keys(stream));
    });
    await round(`${kind} with handlers on the prototype`, () => {
      const Below = class extends classes[kind] {};
      Below.prototype._events = { x() {} };
      const stream = new Below();
      say(Object.keys(stream), stream._eventsCount, Object.keys(stream._events));
    });
    await round(`${kind} with fields below`, () => {
      const Below = class extends classes[kind] {
        _events = { y: 1 };
        _eventsCount = 7;
      };
      const stream = new Below();
      say(Object.keys(stream), stream._eventsCount, Object.keys(stream._events));
    });
    await round(`${kind} has members`, () => say(Object.getOwnPropertyNames(classes[kind].prototype)));
  }
  await round("methods of Writable in Duplex", () => {
    for (const name of ["write", "cork", "uncork", "setDefaultEncoding", "_write", "_writev", "end", "destroy", "pipe"])
      say(name, Duplex.prototype[name] === Writable.prototype[name], Object.hasOwn(Duplex.prototype, name));
  });
})();
