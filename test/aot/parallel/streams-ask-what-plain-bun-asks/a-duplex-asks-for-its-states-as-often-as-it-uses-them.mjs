import stream from "node:stream";
const { Duplex, Readable, Transform, Writable } = stream;
const lines = [];
const later = () => new Promise(resolve => setImmediate(resolve));
const methods = {
  read() {},
  write(chunk, encoding, callback) {
    callback();
  },
  transform(chunk, encoding, callback) {
    callback();
  },
};
{
  const R = Readable.ReadableState,
    W = Writable.WritableState;
  const log = [];
  Readable.ReadableState = function (options, owner, isDuplex) {
    log.push("readable " + isDuplex);
    const state = new R(options, owner, isDuplex);
    state.highWaterMark = 7;
    return state;
  };
  Writable.WritableState = function (options, owner, isDuplex) {
    log.push("writable " + isDuplex);
    const state = new W(options, owner, isDuplex);
    state.highWaterMark = 9;
    return state;
  };
  const made = new Duplex(methods);
  lines.push("wrapped classes " + made.readableHighWaterMark + " " + made.writableHighWaterMark + " " + log.join());
  Readable.ReadableState = R;
  Writable.WritableState = W;
}
for (const Base of [Duplex, Transform]) {
  for (const options of [{}, { readable: false }, { writable: false }]) {
    const log = [];
    let reads = 0;
    const wrap = (name, state) =>
      new Proxy(state, {
        set(target, key, value) {
          if (typeof key === "string") log.push(name + "." + key + "=" + String(value));
          target[key] = value;
          return true;
        },
      });
    class Wrapped extends Base {
      get _readableState() {
        reads++;
        return this.r;
      }
      set _readableState(state) {
        this.r = wrap("readable", state);
      }
      get _writableState() {
        reads++;
        return this.w;
      }
      set _writableState(state) {
        this.w = wrap("writable", state);
      }
    }
    new Wrapped({ ...options, ...methods });
    lines.push(Base.name + " " + JSON.stringify(options) + " " + reads + " " + log.join(" "));
  }
}
async function write(label, side, change, options = {}) {
  const log = [];
  const made = new Transform({
    transform(chunk, encoding, callback) {
      callback(null, options.highWaterMark ? chunk : undefined);
    },
    ...options,
  });
  made.on("error", error => log.push(error.code));
  change(made);
  made._write(Buffer.alloc(1000), "buffer", () => log.push("callback"));
  log.push("behind the write");
  await later();
  lines.push(side + " " + label + ": " + log.join());
}
for (const [side, options] of [
  ["_readableState", {}],
  ["_writableState", { highWaterMark: 10 }],
]) {
  await write("untouched", side, () => {}, options);
  await write(
    "own getter",
    side,
    made => Object.defineProperty(made[side], "ended", { get: () => true, configurable: true }),
    options,
  );
  await write(
    "own value",
    side,
    made => Object.defineProperty(made[side], "ended", { value: true, configurable: true }),
    options,
  );
  await write(
    "stored",
    side,
    made => {
      made[side].ended = true;
    },
    options,
  );
}
await write("another object", "_readableState", made => {
  made._readableState = { ended: true, length: 0, highWaterMark: 1 };
});
await write(
  "another object",
  "_writableState",
  made => {
    made._writableState = { ended: true };
  },
  { highWaterMark: 10 },
);
console.log(lines.join("\n"));
process.exit(0);
