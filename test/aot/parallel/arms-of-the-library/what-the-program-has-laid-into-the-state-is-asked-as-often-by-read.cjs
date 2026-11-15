// read() reckons with the flags, the length, the mark, the list of chunks and its index. The program reaches all of them through _readableState and may lay there what runs its own code:
// each such thing says when it is asked, and what the flags are at that moment.
const { Readable } = require("node:stream");
const turns = Number(process.argv[2] ?? 3);
let lines = [];
const flagsName = Object.getOwnPropertySymbols(new Readable()._readableState).find(symbol => String(symbol) === "Symbol(kState)");
const flagsOf = state => {
  const descriptor = Object.getOwnPropertyDescriptor(state, flagsName);
  const held = descriptor === undefined ? "absent" : "value" in descriptor ? descriptor.value : "an accessor";
  return typeof held === "object" && held !== null ? "an object" : String(held);
};
const shown = value => (value === null ? "null" : Buffer.isBuffer(value) ? "bytes " + value : typeof value === "string" ? JSON.stringify(value) : typeof value);
const telling = (state, name, value) => ({
  valueOf() {
    lines.push("  " + name + " is asked for its value; the flags: " + flagsOf(state));
    return value;
  },
});
const underAccessor = (state, name) => {
  let held = state[name];
  Object.defineProperty(state, name, {
    configurable: true,
    enumerable: true,
    get() {
      lines.push("  " + String(name) + " is read; the flags: " + flagsOf(state));
      return held;
    },
    set(value) {
      lines.push("  " + String(name) + " is stored: " + String(value));
      held = value;
    },
  });
};
const deeds = {
  nothing: () => {},
  "the length is an object": state => (state.length = telling(state, "the length", state.length)),
  "the mark is an object": state => (state.highWaterMark = telling(state, "the mark", 3)),
  "the flags are an object": state => (state[flagsName] = telling(state, "the flags", state[flagsName])),
  "the index is an object": state => (state.bufferIndex = telling(state, "the index", state.bufferIndex)),
  "the length is a text": state => (state.length = String(state.length)),
  "the mark is a text": state => (state.highWaterMark = "3"),
  "the flags are no whole number": state => (state[flagsName] += 0.5),
  "the flags are beyond 32 bits": state => (state[flagsName] += 2 ** 40),
  "the length is no number": state => (state.length = NaN),
  "the mark is endless": state => (state.highWaterMark = Infinity),
  "the length lies under an accessor": state => underAccessor(state, "length"),
  "the mark lies under an accessor": state => underAccessor(state, "highWaterMark"),
  "the flags lie under an accessor": state => underAccessor(state, flagsName),
  "the list lies under an accessor": state => underAccessor(state, "buffer"),
  "the index lies under an accessor": state => underAccessor(state, "bufferIndex"),
  "the flags are deleted": state => delete state[flagsName],
  "the length is deleted": state => delete state.length,
  "the mark is deleted": state => delete state.highWaterMark,
  "the state is frozen": state => Object.freeze(state),
  "the state is sealed": state => Object.seal(state),
  "the flags are read-only": state => Object.defineProperty(state, flagsName, { writable: false }),
  "the list is no list": state => {
    const chunks = [...state.buffer];
    state.buffer = {
      get length() {
        lines.push("  the length of what is no list is read; the flags: " + flagsOf(state));
        return chunks.length;
      },
      set length(value) {
        chunks.length = value;
      },
      get 0() {
        lines.push("  its first is read; the flags: " + flagsOf(state));
        return chunks[0];
      },
      set 0(value) {
        chunks[0] = value;
      },
    };
  },
  "the first chunk tells when its length is read": state => {
    if (state.buffer.length === 0) return;
    const real = state.buffer[0];
    state.buffer[0] = {
      get length() {
        lines.push("  the length of the first chunk is read; the flags: " + flagsOf(state));
        return real.length;
      },
      slice(...range) {
        lines.push("  the first chunk is sliced; the flags: " + flagsOf(state));
        return real.slice(...range);
      },
      toString() {
        lines.push("  the first chunk is made a text; the flags: " + flagsOf(state));
        return String(real);
      },
    };
  },
  "the first chunk is a hole": state => delete state.buffer[0],
  "another state of the same class": (state, stream) => (stream._readableState = new Readable({ read() {} })._readableState),
  "a state below the state": (state, stream) => (stream._readableState = Object.create(state)),
  "the state lies under an accessor": (state, stream) =>
    Object.defineProperty(stream, "_readableState", {
      configurable: true,
      get() {
        lines.push("  the state is read; the flags: " + flagsOf(state));
        return state;
      },
    }),
};
const fills = { nothing: [], "one chunk": ["page"], "three chunks": ["pa", "ge", "s!"], "one chunk and the end": ["page", null] };
const manners = { bytes: {}, text: { encoding: "utf8" }, objects: { objectMode: true } };
function once() {
  for (const [deed, lay] of Object.entries(deeds))
    for (const [manner, options] of Object.entries(manners))
      for (const [fill, chunks] of Object.entries(fills)) {
        const stream = new Readable({ ...options, read() { lines.push("  _read; the flags: " + flagsOf(state)); } });
        const state = stream._readableState;
        stream.on("error", () => {});
        for (const chunk of chunks) stream.push(chunk);
        lay(state, stream);
        for (const amount of [[], [0], [1], [], [100]]) {
          let got;
          try {
            got = shown(stream.read(...amount));
          } catch (error) {
            got = "throws " + (error.code ?? error.name);
          }
          lines.push([deed, manner, fill].join(" | ") + ": read(" + amount.join() + ") gives " + got + "; the flags: " + flagsOf(state));
        }
      }
}
process.on("uncaughtException", error => lines.push("  nobody catches " + (error.code ?? error.name)));
module.exports = (async () => {
  let first;
  for (let turn = 0; turn < turns; turn++) {
    lines = [];
    once();
    await new Promise(resolve => setImmediate(resolve));
    const text = lines.join("\n");
    if (turn === 0) first = text;
    else if (text !== first) console.log("turn " + turn + " parts from the first");
  }
  console.log(first);
})();
