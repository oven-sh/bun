// `this.read = options.read` in a constructor, below a method `read` of the prototype object: the store makes a property of the object while the method is a writable data property.
// Later the method becomes a setter, read-only, or its holder is frozen: from then on the same store does what the language says.
"use strict";
const log = [];
function Source(options) {
  this.size = 1;
  if (options && typeof options.read === "function") this.read = options.read;
}
Source.prototype.read = function () {
  return "inherited " + this.size;
};
function Heir(options) {
  Source.call(this, options);
  this.kind = "heir";
}
Object.setPrototypeOf(Heir.prototype, Source.prototype);
class Reader {
  constructor(options) {
    this.size = 2;
    if (options && typeof options.read === "function") this.read = options.read;
  }
  read() {
    return "method " + this.size;
  }
}
function own() {
  return "own " + this.size;
}
function show(title, make) {
  try {
    const made = make();
    log.push(title + ": " + made.read() + " " + Object.hasOwn(made, "read") + " " + Object.keys(made).join());
  } catch (error) {
    log.push(title + ": " + error.constructor.name);
  }
}
function round(title) {
  for (let i = 0; i < 3; i++) {
    show(title + " Source", () => new Source(i & 1 ? { read: own } : undefined));
    show(title + " Heir", () => new Heir(i & 1 ? { read: own } : undefined));
    show(title + " Reader", () => new Reader(i & 1 ? { read: own } : undefined));
  }
}
round("at first");
const method = Source.prototype.read;
Object.defineProperty(Source.prototype, "read", {
  configurable: true,
  get() {
    return method;
  },
  set(value) {
    log.push("setter of Source got " + value.name);
  },
});
Object.defineProperty(Reader.prototype, "read", {
  configurable: true,
  get() {
    return () => "getter";
  },
  set(value) {
    log.push("setter of Reader got " + value.name);
  },
});
round("below a setter");
Object.defineProperty(Source.prototype, "read", { configurable: true, writable: false, value: method });
Object.defineProperty(Reader.prototype, "read", { configurable: true, writable: false, value: method });
round("below a read-only method");
Object.defineProperty(Source.prototype, "read", { configurable: true, writable: true, value: method });
Object.defineProperty(Reader.prototype, "read", { configurable: true, writable: true, value: method });
round("writable again");
Object.freeze(Source.prototype);
Object.freeze(Reader.prototype);
round("below a frozen holder");
console.log(log.join("\n"));
