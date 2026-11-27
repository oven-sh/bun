const EventEmitter = require("node:events");
const { Readable, Stream } = require("node:stream");
const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
const describe = stream => {
  const symbols = Object.getOwnPropertySymbols(stream).map(symbol => String(symbol) + "=" + String(stream[symbol]));
  return (
    Object.keys(stream).join(",") +
    " | " +
    symbols.join(",") +
    " | table " +
    Object.keys(stream._events).join(",") +
    " below " +
    (Object.getPrototypeOf(stream._events) === null ? "nothing" : "an object") +
    " | counts " +
    stream._eventsCount
  );
};
const bear = (name, make) => {
  try {
    say(name + ":", describe(make()));
  } catch (error) {
    say(name, "throws", error.constructor.name, error.message.split(" (")[0]);
  }
};
class Heir extends Readable {}
function OldHeir(options) {
  Readable.call(this, options);
}
Object.setPrototypeOf(OldHeir.prototype, Readable.prototype);
const bearAll = when => {
  for (let turn = 0; turn < 3; turn++) {
    bear(when + " new Readable()", () => new Readable());
    bear(when + " new Readable({ read })", () => new Readable({ read() {} }));
    bear(when + " Readable()", () => Readable());
    bear(when + " Readable.from()", () => Readable.from(["made", "up"]));
    bear(when + " an heir", () => new Heir());
    bear(when + " an heir of the old kind", () => new OldHeir());
    bear(when + " under another new.target", () => Reflect.construct(Readable, [], OldHeir));
  }
};
bearAll("before");
Object.defineProperty(EventEmitter.prototype, "__proto__", {
  value: {
    get _events() {
      say("the getter of what lies there runs");
      return undefined;
    },
  },
  writable: true,
  enumerable: true,
  configurable: true,
});
bearAll("behind");
console.log(said.join("\n"));
