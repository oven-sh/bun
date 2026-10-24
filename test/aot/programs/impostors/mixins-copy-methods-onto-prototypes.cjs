const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function makeMixin() {
  const mixin = {
    serial: 0,
    tag() {
      return "tagged " + this.title;
    },
    get shout() {
      log.push("get shout of " + show(this.title));
      return String(this.title).toUpperCase();
    },
    [Symbol.for("secret")]() {
      return "secret of " + this.title;
    },
  };
  Object.defineProperty(mixin, "quiet", { value() { return "quiet " + this.title; }, enumerable: false });
  return Object.setPrototypeOf(mixin, { inheritedByTheMixin() { return "inherited " + this.title; } });
}

const copiers = [
  ["Object.assign", (target, source) => Object.assign(target, source)],
  ["a for-in loop", (target, source) => { for (const name in source) target[name] = source[name]; }],
  ["a for-in loop with hasOwnProperty", (target, source) => { for (const name in source) if (Object.prototype.hasOwnProperty.call(source, name)) target[name] = source[name]; }],
  ["Object.keys and forEach", (target, source) => Object.keys(source).forEach(name => { target[name] = source[name]; })],
  ["own names and descriptors", (target, source) => { for (const name of Object.getOwnPropertyNames(source)) Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name)); }],
  ["Object.defineProperties with all descriptors", (target, source) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(source))],
  ["a spread into a new prototype", (target, source, Maker) => { Maker.prototype = { ...target, ...source }; }],
  ["the mixin put into the prototype chain", (target, source) => Object.setPrototypeOf(target, source)],
];

function tagOf(thing) {
  return thing.tag();
}

function shoutOf(thing) {
  return thing.shout;
}

function titleLineOf(thing) {
  return thing.titleLine();
}

for (const [label, copy] of copiers) {
  function Book(title) {
    this.title = title;
  }
  Book.prototype.titleLine = function () {
    return "book " + this.title;
  };
  Book.prototype.tag = function () {
    return "the book's own tag " + this.title;
  };

  const makeBook = title => new Book(title);
  const before = makeBook("before");
  let length = 0;
  for (let i = 0; i < 2000; i++) length += tagOf(before).length + titleLineOf(before).length;
  console.log(label + ": 2000 calls before the mixin", length);

  const mixin = makeMixin();
  attempt(label + ": copy", () => void copy(Book.prototype, mixin, Book));
  const after = makeBook("after");
  for (const [which, book] of [["made before", before], ["made after", after]]) {
    attempt(label + ", " + which + ": tag()", () => tagOf(book));
    attempt(label + ", " + which + ": shout", () => shoutOf(book));
    attempt(label + ", " + which + ": titleLine()", () => titleLineOf(book));
    attempt(label + ", " + which + ": quiet()", () => book.quiet());
    attempt(label + ", " + which + ": inheritedByTheMixin()", () => book.inheritedByTheMixin());
    attempt(label + ", " + which + ": the symbol method", () => book[Symbol.for("secret")]());
  }
  attempt(label + ": shout on the prototype is", () => { const found = Object.getOwnPropertyDescriptor(Book.prototype, "shout"); return found === undefined ? "absent" : "get" in found ? "an accessor" : found.value; });
  attempt(label + ": names on the prototype", () => Object.getOwnPropertyNames(Book.prototype));
  mixin.tag = function () { return "the mixin changed later"; };
  attempt(label + ": after the mixin changed, tag()", () => tagOf(after));
}
