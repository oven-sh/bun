const EventEmitter = require("node:events");
const { Stream, Readable } = require("node:stream");

const show = value => (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? "{" + Reflect.ownKeys(value).map(String).join() + "}" + (Object.getPrototypeOf(value) === null ? " of null" : "") : String(value));
function say(title, make) {
  let made;
  try {
    made = make();
  } catch (error) {
    console.log(title + ": throws " + error.code + (error.made ? " | " + Reflect.ownKeys(error.made).map(String).join() : ""));
    return;
  }
  console.log(title + ": " + Reflect.ownKeys(made).map(key => String(key) + "=" + show(made[key])).join(" | ") + " || " + [made._eventsCount, made._maxListeners, made.getMaxListeners(), made.listenerCount("x")].join());
}

say("new", () => new EventEmitter());
say("options without the name", () => new EventEmitter({}));
say("null", () => new EventEmitter(null));
say("captureRejections true", () => new EventEmitter({ captureRejections: true }));
say("captureRejections false", () => new EventEmitter({ captureRejections: false }));
say("captureRejections 1", () => new EventEmitter({ captureRejections: 1 }));
say("captureRejections by a getter", () => {
  let reads = 0;
  const made = new EventEmitter({
    get captureRejections() {
      reads++;
      return true;
    },
  });
  made.reads = reads;
  return made;
});
say("called on an object", () => {
  const object = Object.create(EventEmitter.prototype);
  EventEmitter.call(object);
  return object;
});
say("called twice", () => {
  const object = new EventEmitter();
  object.on("x", () => {});
  object.setMaxListeners(3);
  EventEmitter.call(object);
  return object;
});
say("called on an object with properties", () => {
  const object = Object.assign(Object.create(EventEmitter.prototype), { first: 1 });
  EventEmitter.call(object, { captureRejections: true });
  return object;
});
say("a throw leaves what was stored", () => {
  const object = Object.create(EventEmitter.prototype);
  try {
    EventEmitter.call(object, { captureRejections: "yes" });
  } catch (error) {
    error.made = object;
    throw error;
  }
  return object;
});

class WithLimit extends EventEmitter {}
WithLimit.prototype._maxListeners = 20;
say("the prototype has a limit", () => new WithLimit());
class WithNullLimit extends EventEmitter {}
WithNullLimit.prototype._maxListeners = null;
say("the prototype has null for a limit", () => new WithNullLimit());
class WithZeroLimit extends EventEmitter {}
WithZeroLimit.prototype._maxListeners = 0;
say("the prototype has zero for a limit", () => new WithZeroLimit());

class WithEvents extends EventEmitter {}
WithEvents.prototype._events = { inherited: () => {} };
say("the prototype has events", () => new WithEvents());
say("its own events ahead of the call", () => {
  const object = Object.create(EventEmitter.prototype);
  object._events = { mine: undefined };
  EventEmitter.call(object);
  return object;
});
say("its own limit ahead of the call", () => {
  const object = Object.create(EventEmitter.prototype);
  object._maxListeners = 7;
  EventEmitter.call(object);
  return object;
});

const seen = [];
class WithSetters extends EventEmitter {
  set _maxListeners(value) {
    seen.push("limit " + value);
  }
  get _maxListeners() {
    seen.push("limit read");
    return undefined;
  }
}
say("the limit is an accessor of an heir", () => {
  const made = new WithSetters();
  made.seen = seen.join();
  return made;
});

EventEmitter.captureRejections = true;
say("captureRejections for all", () => new EventEmitter());
say("captureRejections for all, false for one", () => new EventEmitter({ captureRejections: false }));
EventEmitter.captureRejections = false;

say("a stream", () => new Stream());
say("a readable stream", () => {
  const made = new Readable({ read() {} });
  delete made._readableState;
  return made;
});
for (let round = 0; round < 3000; round++) {
  const made = round % 3 === 0 ? new EventEmitter() : round % 3 === 1 ? new WithLimit() : new Stream();
  if (Reflect.ownKeys(made).length !== (round % 3 === 1 ? 4 : 5)) console.log("round " + round + ": " + Reflect.ownKeys(made).map(String).join());
}
console.log("done");
