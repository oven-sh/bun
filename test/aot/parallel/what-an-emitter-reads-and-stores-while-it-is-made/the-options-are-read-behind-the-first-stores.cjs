// The options of an emitter are an object of the program's: an accessor in it sees what the emitter holds at the time when the option is read.
const EventEmitter = require("node:events");
const { Readable, Writable } = require("node:stream");

const text = key => (typeof key === "symbol" ? "[" + String(key.description) + "]" : key);
function watching(label, answer) {
  let self;
  const options = {
    get captureRejections() {
      console.log(label, "| at the read:", Reflect.ownKeys(self).map(text).join(" "));
      return answer;
    },
  };
  return { options, of: object => (self = object) };
}

for (const answer of [false, undefined, true]) {
  const called = watching(`called on an object, the option answers ${answer}`, answer);
  const object = called.of({});
  EventEmitter.call(object, called.options);
  console.log("  behind:", Reflect.ownKeys(object).map(text).join(" "));

  const filled = watching(`called on an object with events of its own, the option answers ${answer}`, answer);
  const withEvents = filled.of({ _events: { close: undefined }, _maxListeners: 3 });
  EventEmitter.call(withEvents, filled.options);
  console.log("  behind:", Reflect.ownKeys(withEvents).map(text).join(" "), withEvents._maxListeners);

  const made = watching(`an heir written as a function, the option answers ${answer}`, answer);
  function Heir(options) {
    made.of(this);
    EventEmitter.call(this, options);
  }
  Object.setPrototypeOf(Heir.prototype, EventEmitter.prototype);
  const heir = new Heir(made.options);
  console.log("  behind:", Reflect.ownKeys(heir).map(text).join(" "));
}

for (const [label, Class] of [
  ["a readable stream", Readable],
  ["a writable stream", Writable],
]) {
  let reads = 0;
  const stream = new Class({
    get captureRejections() {
      reads++;
      return false;
    },
  });
  console.log(label, "| the option was read:", reads > 0, "|", Reflect.ownKeys(stream).map(text).join(" "));
}
try {
  new EventEmitter({ captureRejections: "yes" });
} catch (error) {
  console.log("a text for the option:", error.code);
}
