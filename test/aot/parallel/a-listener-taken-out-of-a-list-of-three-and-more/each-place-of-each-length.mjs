// An event has three to seven listeners, and the one at each place in turn is removed: what is left, in which order it runs, and what a list that was read before still holds.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

function named(name, log) {
  const listener = () => log.push(name);
  Object.defineProperty(listener, "name", { value: name });
  return listener;
}
const namesOf = list => list.map(listener => (listener.listener ?? listener).name).join("");

for (const make of [() => new EventEmitter(), () => new Readable({ read() {} })]) {
  for (let length = 3; length <= 7; length++) {
    for (let place = 0; place < length; place++) {
      const log = [];
      const emitter = make();
      const listeners = [];
      for (let i = 0; i < length; i++) {
        listeners.push(named("abcdefg"[i], log));
        if (i % 3 === 2) emitter.once("tick", listeners[i]);
        else emitter.on("tick", listeners[i]);
      }
      const before = emitter._events.tick;
      const removed = [];
      emitter.on("removeListener", (type, listener) => removed.push(type + ":" + listener.name));
      emitter.removeListener("tick", listeners[place]);
      const after = emitter._events.tick;
      emitter.emit("tick");
      console.log(length, place, namesOf(before), namesOf(after), before === after, Array.isArray(after), after.length, log.join(""), removed.join(","), emitter.listenerCount("tick"), namesOf(emitter.rawListeners("tick")), Object.keys(after).join(""));
    }
  }
}

// The same function three times and more: the last one goes.
{
  const log = [];
  const emitter = new EventEmitter();
  const twin = named("t", log), other = named("o", log);
  for (const listener of [twin, other, twin, other, twin]) emitter.on("tick", listener);
  for (let i = 0; i < 4; i++) {
    emitter.removeListener("tick", twin);
    console.log("twins", namesOf(emitter.listeners("tick")), typeof emitter._events.tick);
  }
}

// A listener that removes others while the event is emitted: the round goes on over the list as it was.
{
  const log = [];
  const emitter = new EventEmitter();
  const a = named("a", log), c = named("c", log), d = named("d", log);
  const b = () => {
    log.push("b");
    emitter.removeListener("tick", c);
    emitter.removeListener("tick", a);
  };
  for (const listener of [a, b, c, d]) emitter.on("tick", listener);
  emitter.emit("tick");
  emitter.emit("tick");
  console.log("amid a round", log.join(""));
}

// A list that has been warned about stays so in its copies: one warning.
{
  let warnings = 0;
  // What the process prints of a warning names its own number and file.
  process.emitWarning = warning => {
    warnings++;
    console.log("warning", warning.name, warning.count, String(warning.type));
  };
  const emitter = new EventEmitter();
  emitter.setMaxListeners(3);
  const log = [];
  const listeners = [..."abcde"].map(name => named(name, log));
  for (const listener of listeners) emitter.on("tick", listener);
  console.log("warned", emitter._events.tick.warned);
  emitter.removeListener("tick", listeners[1]);
  console.log("warned in the copy", emitter._events.tick.warned, Object.keys(emitter._events.tick).join(","));
  emitter.on("tick", listeners[1]);
  await new Promise(resolve => setImmediate(resolve));
  console.log("warnings", warnings);
}
