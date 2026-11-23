// A class of the program's below EventEmitter has accessors under the names and symbols that an emitter fills: they write down each read and each store, in their order.
const EventEmitter = require("node:events");

const text = key => (typeof key === "symbol" ? "[" + String(key.description) + "]" : key);
const keys = Reflect.ownKeys(new EventEmitter());
console.log("an emitter holds:", keys.map(text).join(" "));

function heirWith(watched, first) {
  const seen = [];
  class Heir extends EventEmitter {}
  for (const key of watched) {
    let held = first.get(key);
    Object.defineProperty(Heir.prototype, key, {
      configurable: true,
      get() {
        seen.push("read " + text(key));
        return held;
      },
      set(value) {
        seen.push("store " + text(key));
        held = value;
      },
    });
  }
  return { Heir, seen };
}

for (const key of keys) {
  const { Heir, seen } = heirWith([key], new Map());
  new Heir();
  console.log("an accessor under", text(key), "|", seen.join(" . "));
}
{
  const { Heir, seen } = heirWith(keys, new Map());
  new Heir();
  console.log("accessors under all |", seen.join(" . "));
}
{
  const { Heir, seen } = heirWith(keys, new Map([["_events", { close: undefined }], ["_maxListeners", 5]]));
  new Heir({ captureRejections: false });
  console.log("accessors under all, events and a limit are there |", seen.join(" . "));
}
{
  const { Heir, seen } = heirWith(keys, new Map());
  new Heir({ captureRejections: true });
  console.log("accessors under all, rejections are captured |", seen.join(" . "));
}
