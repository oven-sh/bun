// heirs.cjs throws twice and runs again at the next require(). Each run makes classes below classes of the library. An accessor on a prototype of one run takes the stores of the objects of that run alone.
globalThis.kept = [];
function load() {
  for (let turn = 0; turn < 4; turn++) {
    try {
      return require("./heirs.cjs");
    } catch (error) {
      console.log(error.message);
    }
  }
}
function watch(holder, name, stored) {
  Object.defineProperty(holder, name, { get: () => "taken", set: value => stored.push(`${name}:${typeof value}`), configurable: true });
}
function make({ Message, Source, Emitter, Listener }, turns) {
  const seen = new Set();
  for (let turn = 0; turn < turns; turn++) {
    const message = new Message(turn);
    const source = new Source(turn);
    const emitter = new Emitter(turn);
    const listener = new Listener(turn);
    source.on("error", () => {});
    seen.add([message.outputSize, message.own, message._hasBody, Object.keys(message).indexOf("own"), source.own, source.listenerCount("error"), emitter._eventsCount, emitter.own, Object.keys(emitter).join(), listener.own, listener._maxListeners].join(" "));
  }
  return [...seen].join(" | ");
}
const last = load();
console.log(globalThis.kept.length, last === globalThis.kept.at(-1));
for (const classes of globalThis.kept) console.log(make(classes, 30));
const stored = [];
watch(last.Message.prototype, "_hasBody", stored);
console.log(make(last, 2), stored.join());
console.log(make(globalThis.kept[0], 2), stored.length);
watch(globalThis.kept[0].Emitter.prototype, "_eventsCount", stored);
console.log(make(globalThis.kept[0], 2), stored.length);
console.log(make(last, 2), stored.length);
Object.defineProperty(last.Listener.prototype, "_maxListeners", { value: 7, writable: false, configurable: true });
try {
  console.log(make(last, 1));
} catch (error) {
  console.log(error.name);
}
console.log(make(globalThis.kept[1], 3), stored.length);
Object.setPrototypeOf(globalThis.kept[1].Source.prototype, Object.create(Object.getPrototypeOf(globalThis.kept[1].Source.prototype), { _readableState: { get: () => undefined, set: () => stored.push("state"), configurable: true } }));
try {
  console.log(make(globalThis.kept[1], 1));
} catch (error) {
  console.log(error.name, stored.length);
}
