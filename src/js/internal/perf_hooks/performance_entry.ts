// Entries for the Node-only entry types ('net', 'http', 'dns'), which the
// native (WebCore) Performance implementation does not produce.
// https://github.com/nodejs/node/blob/v24.10.0/lib/internal/perf/performance_entry.js

const { PerformanceEntry } = globalThis;

const kName = Symbol("kName");
const kType = Symbol("kType");
const kStart = Symbol("kStart");
const kDuration = Symbol("kDuration");
const kDetail = Symbol("kDetail");

let inspect: typeof import("node:util").inspect;

/**
 * The native PerformanceEntry has no public constructor, so `extends` would
 * make super() throw; Node wires up the same prototype chain by hand for its
 * own internal entries.
 */
class PerformanceNodeEntry {
  constructor(name, type, startTime, duration, detail) {
    this[kName] = name;
    this[kType] = type;
    this[kStart] = startTime;
    this[kDuration] = duration;
    this[kDetail] = detail;
  }

  get name() {
    return this[kName];
  }

  get entryType() {
    return this[kType];
  }

  get startTime() {
    return this[kStart];
  }

  get duration() {
    return this[kDuration];
  }

  get detail() {
    return this[kDetail];
  }

  toJSON() {
    return {
      name: this[kName],
      entryType: this[kType],
      startTime: this[kStart],
      duration: this[kDuration],
      detail: this[kDetail],
    };
  }

  // Print the serialized entry rather than a wall of [Getter]s.
  [Symbol.for("nodejs.util.inspect.custom")](depth, options) {
    if (depth < 0) return this;
    inspect ??= require("node:util").inspect;
    const depth_ = options?.depth;
    return `PerformanceNodeEntry ${inspect(this.toJSON(), { ...options, depth: depth_ == null ? null : depth_ - 1 })}`;
  }
}

// Node leaves `detail` and `toJSON` non-enumerable and marks the four base
// accessors enumerable, which is what a `for...in` over an entry yields.
const kEnumerable = { __proto__: null, enumerable: true };
Object.defineProperties(PerformanceNodeEntry.prototype, {
  name: kEnumerable,
  entryType: kEnumerable,
  startTime: kEnumerable,
  duration: kEnumerable,
});
Object.setPrototypeOf(PerformanceNodeEntry.prototype, PerformanceEntry.prototype);
Object.setPrototypeOf(PerformanceNodeEntry, PerformanceEntry);

function createPerformanceNodeEntry(name, type, startTime, duration, detail) {
  return new PerformanceNodeEntry(name, type, startTime, duration, detail);
}

export default {
  createPerformanceNodeEntry,
};
