// heirs.cjs throws and runs again at the next require(). The prototypes of its second run have accessors from the start, so the objects of that run alone leave the library's stores to them.
globalThis.kept = [];
globalThis.stored = [];
function load() {
  for (let turn = 0; turn < 3; turn++) {
    try {
      return require("./heirs.cjs");
    } catch (error) {
      console.log(error.message);
      console.log(make(globalThis.kept[0], 40));
    }
  }
}
function make({ Message, Emitter, Listener }, turns) {
  const seen = new Set();
  for (let turn = 0; turn < turns; turn++) {
    const message = new Message(turn);
    const emitter = new Emitter(turn);
    const listener = new Listener(turn);
    seen.add([message.outputSize, message.own, message._hasBody, Object.keys(message).indexOf("_hasBody") >= 0, emitter._eventsCount, emitter._maxListeners, Object.keys(emitter).join(), listener.own, listener._eventsCount, listener._maxListeners, Object.keys(listener).join()].join(" "));
  }
  return [...seen].join(" | ");
}
const last = load();
console.log(globalThis.kept.length, last === globalThis.kept.at(-1));
console.log(make(last, 2));
console.log(globalThis.stored.join());
console.log(make(globalThis.kept[0], 40), globalThis.stored.length);
console.log(make(last, 40), globalThis.stored.length);
