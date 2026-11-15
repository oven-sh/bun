// STATISTIC: FieldsReadAsStrings >= 1
"use strict";

// A class reads the characters of a field that it is given from outside. The field may hold anything.
class Reader {
  constructor(source, options) {
    this.source = source;
    this.options = options;
    this.at = 0;
    this.lines = [];
  }
  unit(offset) {
    return this.source.charCodeAt(this.at + offset);
  }
  point() {
    return this.source.codePointAt(this.at);
  }
  mark() {
    return this.source[this.at];
  }
  take(length) {
    const taken = this.source.slice(this.at, this.at + length);
    this.at += length;
    return taken;
  }
  peek() {
    return this.source.substr(this.at, 3);
  }
  isEnd() {
    return this.at >= this.source.length;
  }
  isQuote() {
    return this.source[this.at] === '"';
  }
  find(text) {
    return this.source.indexOf(text, this.at);
  }
  joined() {
    return "<" + this.source + ">";
  }
  isSame(other) {
    return this.source === other;
  }
  kind() {
    return typeof this.source;
  }
  replaceSource(source) {
    this.source = source;
    return this;
  }
}

// Two readers below: one hides the field behind an accessor, one adds to it.
class Lazy extends Reader {
  get options() {
    return { lazy: true };
  }
  set options(value) {
    this.given = value;
  }
}
class Wide extends Reader {
  take(length) {
    return super.take(length) + "|" + this.source.length;
  }
}

const steps = [
  (reader) => reader.unit(0),
  (reader) => reader.point(),
  (reader) => reader.mark(),
  (reader) => reader.isQuote(),
  (reader) => reader.peek(),
  (reader) => reader.take(2),
  (reader) => reader.unit(1),
  (reader) => reader.isEnd(),
  (reader) => reader.find("b"),
  (reader) => reader.joined(),
  (reader) => reader.isSame("ab\"c"),
  (reader) => reader.kind(),
  (reader) => reader.take(1.5),
  (reader) => reader.mark(),
  (reader) => reader.at,
];

const own = {
  charCodeAt(at) {
    return 1000 + at;
  },
  codePointAt: (at) => -at,
  slice: (from, to) => [from, to],
  substr: undefined,
  indexOf: () => 77,
  length: 3,
  0: "zero",
  toString() {
    return "own";
  },
};
const sources = JSON.parse('["ab\\"c", "", "\\u00e9\\ud83d\\ude00b", 12, null, true, ["a", "b", "c"], { "length": 2, "0": "x" }]');
sources.push(own, undefined, new String("boxed"), 12n, Symbol("s"), new Uint8Array([97, 98]), "x".repeat(40) + "yb", ("left" + process.argv.length).repeat(3), Object.create(null), () => 1, new Proxy(["p", "q"], {}));

function show(value) {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (value === null || typeof value !== "object") return typeof value === "function" ? "function" : String(value);
  return Object.prototype.toString.call(value) + (Array.isArray(value) ? value.length : "");
}
function tell(reader, step) {
  try {
    return show(step(reader));
  } catch (error) {
    return error.name;
  }
}

globalThis.readers = [];
for (const Kind of [Reader, Lazy, Wide]) {
  for (const source of sources) {
    const reader = new Kind(source, { Kind });
    globalThis.readers.push(reader);
    console.log(Kind.name, show(source), steps.map((step) => tell(reader, step)).join(" , "));
  }
}

// The same reader meets one source after the other.
const reader = new Reader("start", null);
let round = "";
for (let i = 0; i < 60; i++) {
  if (i % 7 === 6) reader.replaceSource(sources[i % sources.length]);
  reader.at = i % 4;
  round += tell(reader, steps[i % steps.length]) + ";";
}
console.log(round);

// The field becomes an accessor, is deleted, is frozen.
const changed = new Reader("abc", 2);
Object.defineProperty(changed, "source", { get: () => "got", configurable: true });
console.log(steps.map((step) => tell(changed, step)).join(" , "));
delete changed.source;
changed.at = 0;
console.log(steps.map((step) => tell(changed, step)).join(" , "));
console.log(steps.map((step) => tell(Object.freeze(new Reader("frozen", 3)), step)).join(" , "));
