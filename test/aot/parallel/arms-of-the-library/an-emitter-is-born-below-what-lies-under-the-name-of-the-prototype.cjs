const EventEmitter = require("node:events");
const { Readable } = require("node:stream");
const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
const bear = (name, object) => {
  const laid = object._events;
  try {
    EventEmitter.call(object);
    say(name, "keeps what was laid:", object._events === laid, "| counts", object._eventsCount);
  } catch (error) {
    say(name, "throws", error.constructor.name, error.message.split(" (")[0]);
  }
};
const table = () => ({ made: "up" });

bear("an object with nothing laid", {});
bear("an object with a table laid", { _events: table() });
bear("a readable", new Readable({ read() {} }));

function Old() {
  this._events = table();
}
Old.prototype = Object.create(EventEmitter.prototype);
bear("an heir of the old kind", new Old());

const above = new EventEmitter();
above.on("made up", () => {});
bear("an object below an emitter", Object.create(above));
const shared = Object.create(above);
shared._events = above._events;
bear("an object that holds the table of the emitter above it", shared);

class Watched extends EventEmitter {
  get __proto__() {
    say("the getter of an heir runs");
    return { _events: undefined };
  }
}
const watched = Object.create(Watched.prototype);
watched._events = table();
bear("an heir with a getter under the name", watched);

const handsOutTheSame = table();
const underValue = Object.create(
  Object.defineProperty(Object.create(EventEmitter.prototype), "__proto__", {
    value: { _events: handsOutTheSame },
    writable: true,
    enumerable: true,
    configurable: true,
  }),
);
underValue._events = handsOutTheSame;
bear("an object below a value under the name", underValue);

const own = Object.defineProperty({ _events: handsOutTheSame }, "__proto__", {
  value: { _events: handsOutTheSame },
  writable: true,
  enumerable: true,
  configurable: true,
});
bear("an object with a value of its own under the name", own);

const ownGetter = Object.defineProperty({ _events: table() }, "__proto__", {
  configurable: true,
  get() {
    say("its own getter runs");
    return {
      get _events() {
        say("the getter of what it hands out runs");
        return undefined;
      },
    };
  },
});
bear("an object with a getter of its own under the name", ownGetter);

const bare = Object.create(null);
bare._events = table();
bear("an object below nothing", bare);
const belowBare = Object.create(Object.create(null));
belowBare._events = table();
bear("an object two steps below nothing", belowBare);

const belowProxy = Object.create(
  new Proxy(EventEmitter.prototype, {
    get(target, key, receiver) {
      say("the proxy is asked for", String(key));
      return Reflect.get(target, key, receiver);
    },
    getPrototypeOf(target) {
      say("the proxy is asked for its prototype");
      return Reflect.getPrototypeOf(target);
    },
    getOwnPropertyDescriptor(target, key) {
      say("the proxy is asked what it holds under", String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  }),
);
belowProxy._events = table();
bear("an object below a proxy", belowProxy);

const getterAbove = Object.create(
  Object.defineProperty(Object.create(EventEmitter.prototype), "_events", {
    configurable: true,
    get() {
      say("the getter of the table above runs");
      return undefined;
    },
    set(value) {
      Object.defineProperty(this, "_events", { value, writable: true, enumerable: true, configurable: true });
    },
  }),
);
getterAbove._events = table();
bear("an object below a getter of the table", getterAbove);
console.log(said.join("\n"));
