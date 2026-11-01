// `EventEmitter.prototype._eventsCount = 0`: a stream has the count of the prototype until its first listener, and `target._eventsCount++` then gives it a count of its own.
// That increment looks the name up once, to read it, and creates the field without a second lookup.
// COUNT: arrivals <= 54000
"use strict";
const { EventEmitter } = require("node:events");
const { Readable, Transform } = require("node:stream");
// The compiler does not see which name this is.
const key = ["_events", "Count"].join("");
const listener = () => {};

let sum = 0;
let last;
for (let i = 0; i < 3000; i++) {
  last = new Readable({ read() {} });
  const hadIt = Object.hasOwn(last, key);
  last.on("custom", listener);
  if (i & 1) last.on("other", listener);
  sum += last[key] + (hadIt ? 1000 : 0) + (Object.hasOwn(last, key) ? 0 : 100000) + new Transform()[key];
}
console.log(sum, Object.keys(last).indexOf(key), Object.keys(last).length, EventEmitter.prototype[key]);

function show(what, make) {
  let stream;
  try {
    stream = make();
    stream.on("custom", listener);
    console.log(what, stream[key], Object.hasOwn(stream, key), Object.keys(stream).indexOf(key), JSON.stringify(Object.getOwnPropertyDescriptor(stream, key)), stream.listenerCount("custom"));
  } catch (error) {
    console.log(what, error.constructor.name, error.message, !!stream && Object.hasOwn(stream, key));
  }
}
const make = () => new Readable({ read() {} });

show("fresh", make);
show("a second listener", () => make().on("other", listener));
show("a transform", () => new Transform());
show("an emitter", () => new EventEmitter());
show("a field comes first", () => Object.assign(make(), { other: 1 }));
show("deleted", () => {
  const stream = make().on("other", listener);
  delete stream[key];
  return stream;
});
show("frozen", () => Object.freeze(make()));
show("sealed", () => Object.seal(make()));
show("not extensible", () => Object.preventExtensions(make()));
show("its own accessor", () => {
  let held = 7;
  return Object.defineProperty(make(), key, { get: () => held, set: value => void (held = value * 2), enumerable: true, configurable: true });
});
show("its own read-only count", () => Object.defineProperty(make(), key, { value: 3, writable: false, enumerable: true, configurable: true }));
show("its own text", () => Object.assign(make(), { [key]: "41" }));
show("a prototype between", () => Object.setPrototypeOf(make(), Object.create(Readable.prototype, { [key]: { value: 20, writable: true } })));
show("a read-only count between", () => Object.setPrototypeOf(make(), Object.create(Readable.prototype, { [key]: { value: 30, writable: false } })));
show("an accessor between", () => {
  const log = [];
  const between = Object.create(Readable.prototype, {
    [key]: {
      get() {
        log.push("get " + Object.hasOwn(this, key));
        return 40;
      },
      set(value) {
        log.push("set " + value + " " + Object.hasOwn(this, key));
      },
    },
  });
  queueMicrotask(() => console.log("an accessor between:", log.join("; ")));
  return Object.setPrototypeOf(make(), between);
});
show("a proxy between", () => {
  const log = [];
  const between = new Proxy(Readable.prototype, {
    get(target, name, receiver) {
      if (name === key) log.push("get " + Object.hasOwn(receiver, key));
      return Reflect.get(target, name, receiver);
    },
    set(target, name, value, receiver) {
      log.push("set " + String(name) + " " + value + " " + Object.hasOwn(receiver, key));
      return Reflect.set(target, name, value, receiver);
    },
  });
  queueMicrotask(() => console.log("a proxy between:", log.join("; ")));
  return Object.setPrototypeOf(make(), between);
});

// What the prototype holds changes: every stream that has no count of its own follows it.
const early = make();
for (const inherited of [5, 2147483647, -0, 1.5, NaN, "8", true, null, undefined, 10n]) {
  EventEmitter.prototype[key] = inherited;
  show("inherits " + typeof inherited + " " + String(inherited), make);
}
const watched = make();
EventEmitter.prototype[key] = {
  valueOf() {
    console.log("valueOf sees", Object.hasOwn(watched, key));
    return 50;
  },
};
show("inherits an object", () => watched);
EventEmitter.prototype[key] = Symbol("no number");
show("inherits a symbol", make);
EventEmitter.prototype[key] = 0;
show("made before the changes", () => early);

Object.defineProperty(EventEmitter.prototype, key, { value: 60, writable: false, configurable: true });
show("the prototype's count is read-only", make);
let stored = 70;
Object.defineProperty(EventEmitter.prototype, key, {
  get() {
    console.log("getter sees", Object.hasOwn(this, key));
    return stored;
  },
  set(value) {
    console.log("setter sees", Object.hasOwn(this, key), value);
    stored = value;
  },
  configurable: true,
});
show("the prototype's count is an accessor", make);
delete EventEmitter.prototype[key];
show("the prototype has no count", make);
Object.defineProperty(EventEmitter.prototype, key, { value: 0, writable: true, enumerable: true, configurable: true });
show("the prototype has its count again", make);
