// The constructor above stores under names that its prototype object has defaults for. One site serves all the heirs. Two heirs are warm when a third makes its first object, and what lies
// above that object decides what the same stores do to it: they create properties, meet a setter, meet a property that cannot be written, or go through a proxy.
const EventEmitter = require("node:events");
const unseen = new Function("value", "return value");
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const show = (value) => (typeof value === "function" ? "function" : JSON.stringify(value));

function family(label, prepareLate, changeLater) {
  function Base(tag) {
    this.state = tag;
    this.count = 0;
  }
  Base.prototype.state = undefined;
  Base.prototype.count = undefined;
  Base.prototype.touch = function () {
    this.state = this.state + "!";
    this.count++;
    return this.state + this.count;
  };
  function First() { Base.call(this, "first"); }
  Object.setPrototypeOf(First.prototype, Base.prototype);
  function Second() { Base.call(this, "second"); }
  Object.setPrototypeOf(Second.prototype, Base.prototype);
  function Late() { Base.call(this, "late"); }
  Object.setPrototypeOf(Late.prototype, Base.prototype);
  const log = [];
  const describe = (object) => [show(Object.keys(object)), show(object.state), show(object.count), object.touch()].join(" ");
  const warm = () => {
    let last;
    for (let round = 0; round < 400; round++) last = describe(round & 1 ? new First() : new Second());
    return last;
  };
  say(label, "warm:", warm());
  prepareLate(unseen(Late), log, Base);
  let late;
  try {
    late = new Late();
    say(label, "late:", describe(late), "| log", show(log));
  } catch (error) {
    say(label, "late throws", error.constructor.name, "| log", show(log));
  }
  say(label, "the others:", warm());
  for (let round = 0; round < 5; round++) {
    try {
      say(label, "late again:", describe(new Late()), "| log", log.length);
    } catch (error) {
      say(label, "late again throws", error.constructor.name);
    }
  }
  if (changeLater) {
    changeLater(unseen(Late), log, Base, First);
    try {
      say(label, "changed, late:", describe(new Late()), "| log", log.length);
    } catch (error) {
      say(label, "changed, late throws", error.constructor.name);
    }
    try {
      say(label, "changed, the others:", warm(), "| log", log.length);
    } catch (error) {
      say(label, "changed, the others throw", error.constructor.name);
    }
  }
}

const setter = (holder, log) => Object.defineProperty(holder, "state", { set(value) { log.push("set " + value); }, get() { return "got"; }, configurable: true });

family("plain", () => {}, (Late, log) => setter(Late.prototype, log));
family("a setter on its own prototype object", (Late, log) => setter(Late.prototype, log));
family("read-only on its own prototype object", (Late) => Object.defineProperty(Late.prototype, "count", { value: 7, writable: false, configurable: true }));
family("an object with a setter put between", (Late, log, Base) => Object.setPrototypeOf(Late.prototype, setter(Object.create(Base.prototype), log)));
family("a proxy put between", (Late, log, Base) => Object.setPrototypeOf(Late.prototype, new Proxy(Object.create(Base.prototype), { set(target, key, value, receiver) { log.push("trap " + String(key)); return Reflect.set(target, key, value, receiver); } })));
family("another prototype object", (Late, log, Base) => { Late.prototype = setter(Object.create(Base.prototype), log); });
family("a setter above all of them, later", () => {}, (Late, log, Base) => setter(Base.prototype, log));
family("a setter on a warm heir, later", () => {}, (Late, log, Base, First) => setter(First.prototype, log));
family("the default is deleted later", () => {}, (Late, log, Base) => { delete Base.prototype.state; });
family("frozen above, later", () => {}, (Late, log, Base) => { Object.freeze(Base.prototype); });

// The same with the library's own constructor function above.
{
  function First() { EventEmitter.call(this); }
  Object.setPrototypeOf(First.prototype, EventEmitter.prototype);
  function Second() { EventEmitter.call(this); }
  Object.setPrototypeOf(Second.prototype, EventEmitter.prototype);
  function Late() { EventEmitter.call(this); }
  Object.setPrototypeOf(Late.prototype, EventEmitter.prototype);
  class LateClass extends EventEmitter {}
  let heard = 0;
  const listener = (value) => { heard += value; };
  const use = (object) => { object.on("told", listener); object.emit("told", 1); return Object.keys(object).join(","); };
  const warm = () => { let last; for (let round = 0; round < 400; round++) last = use(round & 1 ? new First() : new Second()); return last; };
  say("events, warm:", warm(), heard);
  say("events, late:", use(new Late()), heard);
  say("events, the others:", warm(), heard);
  say("events, a late class:", use(new LateClass()), heard);
  say("events, the others:", warm(), heard);
  const seen = [];
  Object.defineProperty(unseen(Late).prototype, "_eventsCount", { set(value) { seen.push(value); }, get() { return seen.length; }, configurable: true });
  say("events, a setter on the late one:", use(new Late()), heard, show(seen));
  say("events, the others:", warm(), heard, seen.length);
}

console.log(lines.join("\n"));
