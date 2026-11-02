// A constructor function whose prototype is a record filled through another name, with defaults under the names that the constructor stores, as node's EventEmitter has them.
// Heirs at module level, and heirs that a function defines each time it is called: one of those inherits a setter, one a read-only property, one an accessor without a setter under a stored name.
function Emitter(label) {
  const events = this._events;
  if (events === undefined || events === Object.getPrototypeOf(this)._events) {
    this._events = Object.create(null);
    this._count = 0;
  }
  this._max = undefined;
  this.label = label;
}
const EmitterPrototype = (Emitter.prototype = {});
EmitterPrototype._events = undefined;
EmitterPrototype._count = 0;
EmitterPrototype._max = 10;
EmitterPrototype.describe = function () {
  return [this.label, this._count, this._max, Object.keys(this).join(), Object.keys(this._events ?? {}).length].join(" ");
};
Object.defineProperty(EmitterPrototype, "constructor", { value: Emitter, writable: true, configurable: true, enumerable: false });

function Stream(label) { Emitter.call(this, label); this.stream = true; }
Object.setPrototypeOf(Stream.prototype, Emitter.prototype);
function Reader(label) { this._events = { data: undefined }; Stream.call(this, label); this.reader = 1; }
Object.setPrototypeOf(Reader.prototype, Stream.prototype);
function Writer(label) { Stream.call(this, label); this.writer = 2; }
Object.setPrototypeOf(Writer.prototype, Stream.prototype);

const log = [];
function defineHeir(kind) {
  function Heir(label) { Stream.call(this, label); this.kind = kind; }
  Object.setPrototypeOf(Heir.prototype, Stream.prototype);
  if (kind === "setter") Object.defineProperty(Heir.prototype, "_count", { set(v) { log.push("set _count " + v); }, get() { return -1; }, configurable: true });
  if (kind === "read-only") Object.defineProperty(Heir.prototype, "_max", { value: 99, writable: false, configurable: true });
  if (kind === "getter") Object.defineProperty(Heir.prototype, "_events", { get() { return undefined; }, configurable: true });
  return Heir;
}
function defineClass(kind) {
  return class Below extends Stream {
    extra = kind;
    constructor(label) { super(label); }
    set _max(v) { log.push("class set _max " + v); }
    get _max() { return kind; }
  };
}
function make(constructor, label) {
  "use strict";
  try { return new constructor(label).describe(); } catch (error) { return error.constructor.name + ": " + label; }
}
const lines = [];
for (let round = 0; round < 300; round++) {
  const line = [make(Emitter, "e"), make(Stream, "s"), make(Reader, "r"), make(Writer, "w")];
  if (round % 50 === 0) {
    for (const kind of ["plain", "setter", "read-only", "getter"]) line.push(make(defineHeir(kind), kind));
    line.push(make(defineClass("c" + round), "class"));
  }
  if (round < 2 || round % 50 === 0) lines.push(line.join(" | "));
}
console.log(lines.join("\n"));
console.log(log.length, log.slice(0, 4).join("; "));
// The default on the shared prototype changes, and a setter appears on it: every heir sees both.
EmitterPrototype._count = 5;
Object.defineProperty(EmitterPrototype, "_max", { set(v) { log.push("shared set _max " + v); }, get() { return "shared"; }, configurable: true });
console.log(make(Emitter, "e"), "|", make(Reader, "r"), "|", make(defineHeir("plain"), "plain"), "|", log.length, log[log.length - 1]);
