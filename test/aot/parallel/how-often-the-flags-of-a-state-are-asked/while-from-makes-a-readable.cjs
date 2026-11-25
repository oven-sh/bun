const { Readable } = require("node:stream");

const first = new Readable({ read() {} })._readableState;
const flags = Object.getOwnPropertySymbols(first).find(symbol => typeof first[symbol] === "number");
const log = [];
for (const key of [flags, "highWaterMark", "buffer", "bufferIndex", "length", "pipes", "awaitDrainWriters"]) {
  const held = new WeakMap();
  const name = typeof key === "symbol" ? "flags" : key;
  Object.defineProperty(Object.getPrototypeOf(first), key, {
    configurable: true,
    get() {
      log.push(name);
      return held.get(this);
    },
    set(value) {
      log.push(name + " = " + (typeof value === "object" ? JSON.stringify(value) : value));
      held.set(this, value);
    },
  });
}

const made = Readable.from([1, 2]);
console.log(log.join(" | "));
log.length = 0;
made.on("data", chunk => console.log("data", chunk));
made.on("end", () => console.log("end", made.readableObjectMode, made.readableHighWaterMark));
