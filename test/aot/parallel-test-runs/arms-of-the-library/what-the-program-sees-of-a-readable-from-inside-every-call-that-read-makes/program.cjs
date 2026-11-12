// read() calls out: _read(), a tick that it queues (a process.nextTick of the program's, an init hook), a listener for "data", an emit() of the program's,
// and whatever the program has laid into the state. Each of them looks at every public face of the stream and of its state, and must find what plain Bun leaves there at that point.
const { Readable } = require("node:stream");
const { createHook } = require("node:async_hooks");
const turns = Number(process.argv[2] ?? 3);
const faces = ["readable", "readableFlowing", "readableLength", "readableHighWaterMark", "readableEnded", "readableDidRead", "readableAborted", "destroyed", "closed"];
const facesOfState = ["reading", "sync", "needReadable", "emittedReadable", "readableListening", "resumeScheduled", "ended", "endEmitted", "flowing", "dataEmitted", "readingMore", "constructed", "errorEmitted", "closeEmitted", "length", "highWaterMark", "bufferIndex", "awaitDrainWriters"];
const short = value => (value === true ? "1" : value === false ? "0" : value === null ? "n" : value === undefined ? "u" : String(value));
let lines = [];
let groups = [];
let group = "";
const say = line => {
  lines.push(line);
  groups.push(group);
};
const look = (where, stream) => {
  const state = stream._readableState;
  say(
    where + ": " + faces.map(face => short(stream[face])).join("") + " " + short(stream.isPaused()) + " " +
      facesOfState.map(face => short(state[face])).join("") + " " + state.buffer.length + " " +
      stream.listenerCount("data") + stream.listenerCount("readable") + stream.listenerCount("end"),
  );
};
const shown = value => (value === null ? "null" : Buffer.isBuffer(value) ? "bytes " + value : JSON.stringify(value));
const ask = (name, stream, ...amount) => {
  look(name + " in front", stream);
  let got;
  try {
    got = shown(stream.read(...amount));
  } catch (error) {
    got = "throws " + (error.code ?? error.name);
  }
  say(name + " read(" + amount.map(String).join() + ") gives " + got);
  look(name + " behind", stream);
};
const amounts = [[], [0], [], [2], [100], [-1], [0], []];
const installed = process.nextTick;
function underTicksOfTheProgram(name, stream, run) {
  process.nextTick = function (callback, ...rest) {
    look(name + " in nextTick", stream);
    return installed.call(process, callback, ...rest);
  };
  try {
    run();
  } finally {
    process.nextTick = installed;
  }
}
function underAnInitHook(name, stream, run) {
  const hook = createHook({
    init(id, type) {
      if (type === "TickObject") look(name + " in init", stream);
    },
  }).enable();
  try {
    run();
  } finally {
    hook.disable();
  }
}
const plainly = (name, stream, run) => run();
const kinds = {
  "read does nothing": options => new Readable({ ...options, read() { look("_read", this); } }),
  "read pushes at once": options => {
    let left = 3;
    return new Readable({
      ...options,
      read(size) {
        look("_read(" + size + ")", this);
        this.push(left-- > 0 ? (options.objectMode ? { left } : "xy") : null);
        look("_read behind its push", this);
      },
    });
  },
  "read throws": options => new Readable({ ...options, read() { look("_read", this); throw new RangeError("made up"); } }),
  "read pauses": options => new Readable({ ...options, read() { this.pause(); look("_read has paused", this); } }),
  "read destroys": options => new Readable({ ...options, read() { this.destroy(); look("_read has destroyed", this); } }),
  "read asks again": options => {
    let deep = 0;
    return new Readable({ ...options, read() { if (deep++ < 2) say("within: " + shown(this.read())); look("_read", this); } });
  },
  "an heir whose _read is a getter that raises the mark": options =>
    new (class extends Readable {
      get _read() {
        look("the getter of _read", this);
        this._readableState.highWaterMark += 1;
        return size => say("_read(" + size + ")");
      }
    })(options),
};
const fills = { nothing: [], "one chunk": ["page"], "three chunks": ["pa", "ge", "s!"], "one chunk and the end": ["page", null], "the end": [null] };
const manners = { bytes: {}, text: { encoding: "utf8" }, objects: { objectMode: true }, "a mark of nothing": { highWaterMark: 0 }, "a mark of two": { highWaterMark: 2 } };
const listeners = {
  nobody: () => {},
  "a listener for data, paused": stream => { stream.on("data", chunk => look("in data " + shown(chunk), stream)); stream.pause(); },
  "a listener for readable": stream => stream.on("readable", () => look("in readable", stream)),
  "an emit of the program's": stream => {
    const emit = stream.emit;
    stream.emit = function (name, ...rest) { look("in emit " + String(name), stream); return emit.call(this, name, ...rest); };
  },
};
const surroundings = { plainly, underTicksOfTheProgram, underAnInitHook };
async function once(under) {
  const surround = surroundings[under];
  for (const [kind, make] of Object.entries(kinds))
    for (const [manner, options] of Object.entries(manners))
      for (const [fill, chunks] of Object.entries(fills))
        for (const [listener, listen] of Object.entries(listeners)) {
          const name = [under, kind, manner, fill, listener].join(" | ");
          group = [under, kind, manner].join(" | ");
          const stream = make(options);
          stream.on("error", error => look("in error " + error.name, stream));
          stream.on("end", () => look("in end", stream));
          stream.on("close", () => look("in close", stream));
          listen(stream);
          surround(name, stream, () => {
            for (const chunk of chunks) stream.push(chunk !== null && options.objectMode ? { chunk } : chunk);
            for (const amount of amounts) ask(name, stream, ...amount);
          });
          await new Promise(resolve => setImmediate(resolve));
          look(name + " at last", stream);
        }
}
module.exports = async under => {
  let first;
  for (let turn = 0; turn < turns; turn++) {
    lines = [];
    groups = [];
    await once(under);
    const text = lines.join("\n");
    if (turn === 0) first = text;
    else if (text !== first) console.log("turn " + turn + " parts from the first");
  }
  const { createHash } = require("node:crypto");
  const all = first.split("\n");
  console.log(all.length + " lines, " + createHash("sha1").update(first).digest("hex"));
  const sums = new Map();
  all.forEach((line, at) => sums.set(groups[at], createHash("sha1").update((sums.get(groups[at]) ?? "") + line).digest("hex").slice(0, 12)));
  for (const [key, sum] of sums) console.log(sum + " " + key);
  if (process.argv[3]) all.forEach((line, at) => groups[at] === process.argv[3] && console.log(line));
};
