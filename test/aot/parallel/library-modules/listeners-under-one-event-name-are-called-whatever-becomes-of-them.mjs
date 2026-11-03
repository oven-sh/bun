// emit("tick") in a loop expects the one listener that the program adds under "tick". Each part does something else to what lies under the name.
import { EventEmitter } from "node:events";

const lines = [];
let heard = 0;
const emitter = new EventEmitter();
const first = function (n) {
  heard += n;
  return this === emitter;
};
emitter.on("tick", first);

function emitOften(target, turns) {
  let answered = 0;
  for (let i = 0; i < turns; i++) if (target.emit("tick", i & 3)) answered++;
  return answered;
}
function report(label, target = emitter) {
  heard = 0;
  const answered = emitOften(target, 8);
  lines.push(`${label}: ${answered} ${heard}`);
}

report("the listener");
emitter.off("tick", first);
report("removed");
emitter._events.tick = n => void (heard += 10 * n);
report("stored by hand");
emitter._events.tick = [first, n => void (heard += 100 * n)];
report("a list stored by hand");
emitter._events.tick = first.bind(emitter);
report("bound");
emitter._events.tick = new Proxy(first, {
  apply(target, receiver, args) {
    heard += 1000;
    return Reflect.apply(target, receiver, args);
  },
});
report("behind a proxy");
emitter._events.tick = class {};
try {
  report("a class");
} catch (error) {
  lines.push("a class: " + error.constructor.name);
}
emitter._events.tick = 5;
try {
  report("a number");
} catch (error) {
  lines.push("a number: " + error.constructor.name);
}
Object.defineProperty(emitter._events, "tick", {
  get() {
    heard += 7;
    return first;
  },
  configurable: true,
});
report("behind a getter");
delete emitter._events.tick;
report("deleted");
emitter._events = undefined;
report("no table");
emitter._events = Object.create({ tick: first });
report("inherited");
emitter.removeAllListeners();
emitter.once("tick", first);
report("once");
emitter.on("tick", first);
emitter.on("tick", first);
report("twice");
emitter.removeAllListeners();
emitter.on("tick", function removesItself(n) {
  heard += n + 1;
  emitter.off("tick", removesItself);
  emitter.on("tick", first);
});
report("replaced while it runs");

const another = new EventEmitter();
report("another emitter without it", another);
another.on("tick", first);
report("another emitter with it", another);
report("no emitter", { emit: (name, n) => (heard += n) > 2 });
class Below extends EventEmitter {
  emit(name, n) {
    heard += 50;
    return super.emit(name, n);
  }
}
const below = new Below();
below.on("tick", first);
report("a class below", below);
console.log(lines.join("\n"));
