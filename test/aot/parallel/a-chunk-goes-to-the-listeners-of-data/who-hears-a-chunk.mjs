// A chunk that a flowing stream hands on: to one listener, to several, to those that come and go meanwhile, through an emit() of the program, and what a listener sees.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));

function source(options) {
  return new Readable({ objectMode: true, read() {}, ...options });
}
async function turn(title, prepare, options) {
  say("==", title);
  const stream = source(options);
  stream.on("error", error => say("  error", error.message));
  let undo;
  try {
    undo = await prepare(stream);
    await tick();
    for (const chunk of ["a", "b", "c"]) {
      try {
        say("  push", chunk, stream.push(chunk));
      } catch (error) {
        say("  push threw", error.constructor.name, error.message);
      }
      await tick();
    }
  } catch (error) {
    say("  threw", error.constructor.name, error.message);
  }
  if (typeof undo === "function") undo();
  stream.destroy();
  await tick();
}

await turn("one listener", stream => {
  stream.on("data", function (...args) {
    say("  heard", args.join(), args.length, this === stream);
  });
});
await turn("three listeners", stream => {
  for (const n of [1, 2, 3]) stream.on("data", chunk => say("  " + n + " heard", chunk));
});
await turn("once, beside a listener that stays", stream => {
  stream.once("data", chunk => say("  once heard", chunk));
  stream.on("data", chunk => say("  always heard", chunk));
});
await turn("once alone", stream => {
  stream.once("data", chunk => say("  once heard", chunk, stream.listenerCount("data"), stream.readableFlowing));
});
await turn("a listener that leaves while it hears", stream => {
  const first = chunk => (say("  first heard", chunk), stream.off("data", first));
  stream.on("data", first);
  stream.on("data", chunk => say("  second heard", chunk));
});
await turn("a listener that brings another", stream => {
  let brought = false;
  stream.on("data", chunk => {
    say("  first heard", chunk);
    if (!brought) stream.on("data", other => say("  brought heard", other));
    brought = true;
  });
});
await turn("a listener laid in front", stream => {
  stream.on("data", chunk => say("  behind heard", chunk));
  stream.prependListener("data", chunk => say("  in front heard", chunk));
});
await turn("all leave while the first hears", stream => {
  stream.on("data", chunk => (say("  first heard", chunk), stream.removeAllListeners("data")));
  stream.on("data", chunk => say("  second heard", chunk));
});
await turn("a listener that throws", stream => {
  stream.on("data", chunk => {
    say("  heard", chunk);
    if (chunk === "b") throw new RangeError("no b");
  });
});
await turn("a listener that pauses", stream => {
  stream.on("data", chunk => {
    say("  heard", chunk);
    stream.pause();
    setImmediate(() => stream.resume());
  });
});
await turn("an emit of its own on the stream", stream => {
  stream.emit = function (type, ...args) {
    say("  emit", String(type), args.length);
    return EventEmitter.prototype.emit.call(this, type, ...args);
  };
  stream.on("data", chunk => say("  heard", chunk));
});
await turn("an emit that is no function", async stream => {
  stream.on("data", chunk => say("  heard", chunk));
  await tick();
  stream.emit = 7;
  return () => delete stream.emit;
});
await turn("an emit through an accessor", stream => {
  Object.defineProperty(stream, "emit", {
    configurable: true,
    get() {
      say("  emit is read");
      return EventEmitter.prototype.emit;
    },
  });
  stream.on("data", chunk => say("  heard", chunk));
});
class Loud extends Readable {
  emit(type, ...args) {
    if (type === "data") say("  the class emits", args.join());
    return super.emit(type, ...args);
  }
}
say("== an emit of the class");
{
  const stream = new Loud({ objectMode: true, read() {} });
  stream.on("data", chunk => say("  heard", chunk));
  await tick();
  stream.push("a");
  await tick();
  stream.destroy();
  await tick();
}
await turn("rejections are captured", stream => {
  stream.on("data", async chunk => {
    say("  heard", chunk);
    if (chunk === "b") throw new Error("rejected at b");
  });
}, { captureRejections: true });
await turn("events that the program has replaced", stream => {
  stream.on("data", chunk => say("  the old one heard", chunk));
  stream._events = { __proto__: null, data: chunk => say("  the new one heard", chunk) };
});
await turn("no events at all", stream => {
  stream.on("data", chunk => say("  heard", chunk));
  stream._events = undefined;
});
await turn("buffered first, then read by a listener", async stream => {
  stream.push("early1");
  stream.push("early2");
  await tick();
  stream.on("data", chunk => say("  heard", chunk));
});
await turn("read by hand beside a listener of data that came and went", stream => {
  const gone = () => {};
  stream.on("data", gone);
  stream.off("data", gone);
  stream.pause();
  stream.on("readable", () => {
    for (let chunk; (chunk = stream.read()) !== null; ) say("  read", chunk);
  });
});

say("== bytes");
{
  const stream = new Readable({ read() {} });
  stream.on("data", chunk => say("  heard", chunk.constructor.name, chunk.toString()));
  await tick();
  stream.push("text");
  stream.push(Buffer.from("bytes"));
  stream.push(new Uint8Array([104, 105]));
  await tick();
  stream.setEncoding("utf8");
  stream.push("more");
  await tick();
  stream.destroy();
  await tick();
}

console.log(log.join("\n"));
