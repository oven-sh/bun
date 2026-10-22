import { inspect } from "node:util";
import { EventEmitter } from "node:events";

const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

async function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(await run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

class Gauge {
  constructor(level) {
    this.level = level;
  }
  toJSON(key) {
    log.push("toJSON " + show(key));
    return { level: this.level, from: "toJSON" };
  }
  toString() {
    log.push("toString");
    return "gauge at " + this.level;
  }
  valueOf() {
    log.push("valueOf");
    return this.level;
  }
  [Symbol.toPrimitive](hint) {
    log.push("toPrimitive " + hint);
    return hint === "string" ? "gauge " + this.level : this.level;
  }
  *[Symbol.iterator]() {
    log.push("iterator");
    yield this.level;
    yield this.level + 1;
  }
  get [Symbol.toStringTag]() {
    log.push("toStringTag");
    return "Gauge";
  }
  [inspect.custom]() {
    log.push("inspect.custom");
    return "a gauge, inspected";
  }
  then(resolve) {
    log.push("then");
    resolve("settled at " + this.level);
  }
  static [Symbol.hasInstance](value) {
    log.push("hasInstance");
    return value === 5;
  }
  get reading() {
    log.push("get reading");
    return this.level * 2;
  }
  reachedByAJoinedName() {
    return "joined name, level " + this.level;
  }
  reachedByAWalkOverTheNames() {
    return "walk, level " + this.level;
  }
  reachedThroughADescriptor() {
    return "descriptor, level " + this.level;
  }
  reachedAsAListener(extra) {
    return log.push("listener, level " + this.level + ", " + extra);
  }
  reachedAsACallback(element) {
    return element + (this === undefined ? " without this" : " level " + this.level);
  }
}

function OldGauge(level) {
  this.level = level;
}
OldGauge.prototype.toJSON = function () {
  log.push("old toJSON");
  return "old gauge " + this.level;
};
OldGauge.prototype.toString = function () {
  log.push("old toString");
  return "old gauge at " + this.level;
};
OldGauge.prototype.valueOf = function () {
  log.push("old valueOf");
  return this.level;
};
OldGauge.prototype.reachedByAJoinedName = function () {
  return "old, joined name, level " + this.level;
};

const comparators = {
  ascending(a, b) {
    return a - b;
  },
  descending(a, b) {
    return b - a;
  },
};

const handler = {
  get(target, key) {
    return typeof key === "string" ? "trapped " + key : undefined;
  },
  has() {
    return true;
  },
  ownKeys() {
    return ["made", "up"];
  },
  getOwnPropertyDescriptor() {
    return { value: "made up", enumerable: true, configurable: true };
  },
};

await attempt("JSON.stringify", () => JSON.stringify({ gauge: new Gauge(1), list: [new Gauge(2)] }));
await attempt("a template", () => `${new Gauge(1)}`);
await attempt("+", () => +new Gauge(1));
await attempt("gauge + ''", () => new Gauge(1) + "");
await attempt("gauge < 5", () => new Gauge(1) < 5);
await attempt("as a key", () => ({ "gauge 1": "found" })[new Gauge(1)]);
await attempt("a spread into a list", () => [...new Gauge(1)]);
await attempt("an array pattern", () => { const [first, second] = new Gauge(1); return [first, second]; });
await attempt("Array.from", () => Array.from(new Gauge(1)));
await attempt("new Set", () => new Set(new Gauge(1)).size);
await attempt("Object.prototype.toString", () => Object.prototype.toString.call(new Gauge(1)));
await attempt("inspect", () => inspect(new Gauge(1)));
await attempt("await", async () => await new Gauge(1));
await attempt("Promise.resolve", () => Promise.resolve(new Gauge(2)));
await attempt("returned from an async function", () => (async () => new Gauge(3))());
await attempt("instanceof", () => [5 instanceof Gauge, new Gauge(1) instanceof Gauge]);
await attempt("a getter through a spread of the prototype's copy", () => ({ ...Object.create(null, { reading: Object.getOwnPropertyDescriptor(Gauge.prototype, "reading"), level: { value: 4 } }) }));
await attempt("a getter through Reflect.get", () => Reflect.get(Gauge.prototype, "reading", { level: 21 }));
await attempt("a joined name", () => new Gauge(1)[["reached", "By", "A", "Joined", "Name"].join("")]());
await attempt("a walk over the names", () => Object.getOwnPropertyNames(Gauge.prototype).filter(name => name.endsWith("OverTheNames")).map(name => new Gauge(1)[name]()));
await attempt("a descriptor", () => Object.getOwnPropertyDescriptor(Gauge.prototype, "reachedThroughADescriptor").value.call(new Gauge(1)));
await attempt("a listener", () => { const emitter = new EventEmitter(); const gauge = new Gauge(1); emitter.on("event", gauge.reachedAsAListener.bind(gauge)); return emitter.emit("event", "emitted"); });
await attempt("a callback with a this argument", () => ["a"].map(Gauge.prototype.reachedAsACallback, new Gauge(1)));
await attempt("a callback without one", () => ["a"].map(Gauge.prototype.reachedAsACallback));
await attempt("old: JSON.stringify", () => JSON.stringify([new OldGauge(1)]));
await attempt("old: a template", () => `${new OldGauge(1)}`);
await attempt("old: arithmetic", () => new OldGauge(2) * 3);
await attempt("old: a joined name", () => new OldGauge(1)[["reachedBy", "AJoinedName"].join("")]());
await attempt("a comparator picked by a joined name", () => [3, 1, 2].sort(comparators[["des", "cending"].join("")]));
await attempt("the other one", () => [3, 1, 2].sort(comparators[["as", "cending"].join("")]));
await attempt("the traps of a handler", () => { const proxy = new Proxy({}, handler); return [proxy.anything, "x" in proxy, Object.keys(proxy), { ...proxy }]; });
