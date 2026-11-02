// emitter.emit("tick", i) in a loop finds the same listener in every turn, unless something in the loop or between two loops changes that.
import { EventEmitter } from "node:events";

let heard = 0;
const emitter = new EventEmitter();
const count = i => void (heard += i & 1);
emitter.on("tick", count);

function emitOften(turns) {
  let answered = 0;
  for (let i = 0; i < turns; i++) if (emitter.emit("tick", i)) answered++;
  return answered;
}
function report(label, turns = 1000) {
  heard = 0;
  let answered;
  try {
    answered = emitOften(turns);
  } catch (error) {
    answered = error.constructor.name;
  }
  console.log(`${label}: ${answered} ${heard} ${emitter.listenerCount("tick")}`);
}

report("the first loop of all", 100000);
report("again");
report("no turn", 0);
emitter.on("tick", count);
report("the same listener twice");
emitter.off("tick", count);
report("once again");
emitter.off("tick", count);
report("nobody listens");
emitter.on("tick", i => void (heard += 2));
report("another listener");
emitter.removeAllListeners("tick");
report("all removed");
emitter.once("tick", count);
report("only once");
emitter.on("tick", count);
emitter.on("other", count);
report("beside another event");
emitter.removeAllListeners();
report("every event removed");
emitter.on("tick", count);
report("back");

// What the listener does to the emitter is seen by the next turn.
const leaving = i => {
  heard += 1;
  if (i === 4) emitter.off("tick", leaving);
};
emitter.off("tick", count);
emitter.on("tick", leaving);
report("a listener that leaves in the fifth turn");
const inviting = i => {
  heard += 1;
  if (i === 4) emitter.on("tick", count);
};
emitter.on("tick", inviting);
report("a listener that brings another in the fifth turn", 10);
emitter.removeAllListeners();

emitter.on("tick", count);
report("as at first");
emitter.emit = () => false;
report("emit is hidden on the emitter");
delete emitter.emit;
report("emit is seen again");
const emitOfAll = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (...args) {
  heard += 100;
  return emitOfAll.apply(this, args);
};
report("emit is replaced for all", 10);
EventEmitter.prototype.emit = emitOfAll;
report("emit is put back");
emitter._events = undefined;
report("without a table");
emitter._events = { __proto__: null, tick: count };
report("with a table made by hand");
emitter._events = { tick: count };
report("with an ordinary object for a table");
emitter._events = Object.create({ tick: count });
report("with a table that inherits the listener");
emitter._events = new Proxy({ tick: count }, { get(target, key) { heard += 10; return target[key]; } });
report("with a table behind a proxy", 10);
