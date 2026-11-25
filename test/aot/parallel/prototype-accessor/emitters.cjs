// Emitters whose `_events` is their own, that of their prototype or none, behind every kind of `__proto__`.
const { EventEmitter } = require("node:events");
const { Readable, Transform, Duplex } = require("node:stream");
const { createGzip } = require("node:zlib");
const kinds = {
  direct: () => new EventEmitter(),
  heir: () => new (class extends EventEmitter {})(),
  readable: () => new Readable({ read() {} }),
  transform: () => new Transform({ transform(c, _, done) { done(null, c); } }),
  duplex: () => new Duplex({ read() {}, write(c, _, done) { done(); } }),
  gzip: () => createGzip(),
  called: () => {
    const o = {};
    EventEmitter.call(o);
    return Object.setPrototypeOf(o, EventEmitter.prototype);
  },
  "own events": () => {
    const o = Object.create(EventEmitter.prototype);
    o._events = { __proto__: null, kept() {} };
    o._eventsCount = 1;
    EventEmitter.call(o);
    return o;
  },
  "events of the prototype": () => {
    const above = Object.create(EventEmitter.prototype);
    above._events = { __proto__: null, above() {} };
    const o = Object.create(above);
    EventEmitter.call(o);
    return o;
  },
  "own __proto__ with the same events": () => {
    const o = Object.create(EventEmitter.prototype);
    o._events = { __proto__: null, kept() {} };
    Object.defineProperty(o, "__proto__", { value: { _events: o._events }, configurable: true });
    EventEmitter.call(o);
    return o;
  },
  "own __proto__ with other events": () => {
    const o = Object.create(EventEmitter.prototype);
    o._events = { __proto__: null, kept() {} };
    Object.defineProperty(o, "__proto__", { value: { _events: {} }, configurable: true });
    EventEmitter.call(o);
    return o;
  },
  "a __proto__ without events": () => {
    const o = Object.create(EventEmitter.prototype);
    o._events = { __proto__: null, kept() {} };
    Object.defineProperty(o, "__proto__", { value: undefined, configurable: true });
    try {
      EventEmitter.call(o);
    } catch (e) {
      return e.constructor.name;
    }
    return o;
  },
  "a getter in between": () => {
    let asked = 0;
    const above = Object.create(EventEmitter.prototype, { __proto__: { get() { asked++; return { _events: this._events }; }, configurable: true, enumerable: true } });
    Object.defineProperty(above, "__proto__", { get() { asked++; return { _events: this._events }; }, configurable: true });
    const o = Object.create(above);
    o._events = { __proto__: null, kept() {} };
    EventEmitter.call(o);
    o.asked = asked;
    return o;
  },
};
for (const [name, make] of Object.entries(kinds)) {
  for (let i = 0; i < 20; i++) make();
  const o = make();
  if (typeof o === "string") {
    console.log(name, o);
    continue;
  }
  const names = o._events ? Reflect.ownKeys(o._events).filter(k => o._events[k] !== undefined).map(String).join() : "none";
  console.log(name, "|", names, "|", o._eventsCount, "|", o.asked ?? "");
  if (typeof o.on === "function") {
    o.on("x", () => console.log("  x of " + name));
    o.emit("x");
  }
}
