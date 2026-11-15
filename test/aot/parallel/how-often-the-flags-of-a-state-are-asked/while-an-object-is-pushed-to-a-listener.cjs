const { Readable } = require("node:stream");

const readable = new Readable({ objectMode: true, read() {} });
const state = readable._readableState;
const flags = Object.getOwnPropertySymbols(state).find(symbol => typeof state[symbol] === "number");
let held = state[flags];
let reads = 0;
let stores = 0;
Object.defineProperty(state, flags, {
  configurable: true,
  get() {
    reads++;
    return held;
  },
  set(value) {
    stores++;
    held = value;
  },
});

const seen = [];
readable.on("data", chunk => seen.push(chunk.n));
let turn = 0;
function pushOne() {
  reads = 0;
  stores = 0;
  const more = readable.push({ n: turn });
  console.log("push", turn, more, "reads", reads, "stores", stores);
  if (++turn < 4) setImmediate(pushOne);
  else console.log(seen.join(","));
}
setImmediate(pushOne);
