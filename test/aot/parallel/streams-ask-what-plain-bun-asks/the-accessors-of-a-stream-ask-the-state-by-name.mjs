import { Duplex, Readable, Writable, finished } from "node:stream";
const lines = [];
const readableNames = [
  ["destroyed", "destroyed"],
  ["closed", "closed"],
  ["errored", "errored"],
  ["endEmitted", "readableEnded"],
  ["dataEmitted", "readableDidRead"],
  ["flowing", "readableFlowing"],
  ["objectMode", "readableObjectMode"],
  ["encoding", "readableEncoding"],
];
const writableNames = [
  ["errored", "errored"],
  ["writable", "writable"],
  ["corked", "writableCorked"],
  ["length", "writableLength"],
  ["highWaterMark", "writableHighWaterMark"],
];
const makeReadable = () => new Readable({ read() {} });
const makeWritable = () =>
  new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
const makeDuplex = () =>
  new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      callback();
    },
  });

for (const [name, accessor] of readableNames) {
  const own = makeReadable();
  Object.defineProperty(own._readableState, name, { value: "own " + name, configurable: true });
  lines.push("own value " + accessor + " " + String(own[accessor]));
  const asked = makeReadable();
  let asks = 0;
  Object.defineProperty(asked._readableState, name, {
    get() {
      asks++;
      return "got " + name;
    },
    configurable: true,
  });
  lines.push("own getter " + accessor + " " + String(asked[accessor]) + " " + asks);
  const below = makeReadable();
  below._readableState = Object.create(below._readableState, { [name]: { value: "below " + name } });
  lines.push("an object below " + accessor + " " + String(below[accessor]));
}
for (const [name, accessor] of writableNames) {
  const own = makeWritable();
  Object.defineProperty(own._writableState, name, {
    value: name === "writable" ? false : "own " + name,
    configurable: true,
  });
  lines.push("own value " + accessor + " " + String(own[accessor]));
  const below = makeDuplex();
  below._writableState = Object.create(below._writableState, {
    [name]: { value: name === "writable" ? false : "below " + name },
  });
  lines.push("an object below " + accessor + " " + String(below[accessor]));
}
{
  class Heir extends Readable.ReadableState {
    get destroyed() {
      return true;
    }
    set destroyed(value) {}
  }
  const stream = makeReadable();
  Object.setPrototypeOf(stream._readableState, Heir.prototype);
  lines.push("a class below " + stream.destroyed + " " + stream.readable);
}
for (const make of [makeReadable, makeWritable, makeDuplex]) {
  const stream = make();
  const seen = [];
  const watched = (side, state) =>
    new Proxy(state, {
      get(target, key) {
        seen.push(side + "." + String(key));
        return target[key];
      },
      getPrototypeOf(target) {
        seen.push(side + " prototype");
        return Reflect.getPrototypeOf(target);
      },
    });
  if (stream._readableState) stream._readableState = watched("r", stream._readableState);
  if (stream._writableState) stream._writableState = watched("w", stream._writableState);
  for (const accessor of [
    "destroyed",
    "closed",
    "errored",
    "readable",
    "readableLength",
    "readableFlowing",
    "writable",
    "writableLength",
    "writableBuffer",
    "writableCorked",
  ]) {
    const answer = stream[accessor];
    lines.push(
      "a proxy " + accessor + " " + (Array.isArray(answer) ? answer.length : answer) + " " + seen.splice(0).join(","),
    );
  }
  finished(stream, () => {});
  lines.push("a proxy finished " + [...new Set(seen.splice(0))].join(","));
}
{
  let asks = 0;
  const usual = Function.prototype[Symbol.hasInstance];
  for (const State of [Readable.ReadableState, Writable.WritableState])
    Object.defineProperty(State, Symbol.hasInstance, {
      configurable: true,
      value(object) {
        asks++;
        return usual.call(this, object);
      },
    });
  const stream = makeDuplex();
  asks = 0;
  const answers = [
    stream.destroyed,
    stream.readable,
    stream.writable,
    stream.readableFlowing,
    stream.writableLength,
    stream.errored,
  ];
  finished(stream, () => {});
  lines.push("hasInstance " + asks + " " + answers.join());
  for (const State of [Readable.ReadableState, Writable.WritableState]) delete State[Symbol.hasInstance];
}
for (const [label, make, side, name] of [
  [
    "writable errorEmitted",
    () =>
      new Writable({
        autoDestroy: false,
        emitClose: false,
        write(c, e, cb) {
          cb();
        },
      }),
    "_writableState",
    "errorEmitted",
  ],
  [
    "readable errorEmitted",
    () => new Readable({ autoDestroy: false, emitClose: false, read() {} }),
    "_readableState",
    "errorEmitted",
  ],
  [
    "writable finished",
    () =>
      new Writable({
        autoDestroy: false,
        write(c, e, cb) {
          cb();
        },
      }),
    "_writableState",
    "finished",
  ],
]) {
  const stream = make();
  Object.defineProperty(stream[side], name, { value: true, configurable: true });
  let said = "no call";
  finished(stream, error => {
    said = error ? error.code : "a call without an error";
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  lines.push("finished " + label + " " + said);
}
for (const [label, lay] of [
  [
    "the readable side keeps itself",
    stream => Object.defineProperty(stream._readableState, "autoDestroy", { value: false }),
  ],
  [
    "the readable side says that it has ended",
    stream => Object.defineProperty(stream._readableState, "endEmitted", { get: () => true, set() {} }),
  ],
  [
    "the writable side says that it has finished",
    stream => Object.defineProperty(stream._writableState, "finished", { value: true }),
  ],
]) {
  const stream = new Duplex({
    read() {
      this.push(null);
    },
    write(chunk, encoding, callback) {
      callback();
    },
  });
  const told = [];
  for (const name of ["end", "finish", "close"]) stream.on(name, () => told.push(name));
  lay(stream);
  stream.resume();
  await new Promise(resolve => setTimeout(resolve, 10));
  stream.end();
  await new Promise(resolve => setTimeout(resolve, 10));
  lines.push(label + ": " + told.join() + " " + stream.destroyed);
}
{
  const stream = makeWritable();
  Writable.WritableState.prototype = null;
  try {
    lines.push("no prototype " + typeof finished(stream, () => {}) + " " + stream.writable);
  } catch (error) {
    lines.push("no prototype threw " + error.name);
  }
}
console.log(lines.join("\n"));
process.exit(0);
