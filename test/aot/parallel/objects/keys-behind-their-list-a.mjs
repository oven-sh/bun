// A key that is read out of a list of names by an index is one of the names, or undefined where the list is shorter.
class Shelf {
  constructor() {
    this.size = 1;
    this.label = "shelf";
  }
}
const say = (...parts) => console.log(...parts.map(part => (typeof part === "object" ? JSON.stringify(part) : String(part))));

// The first name, the last, and one behind the last.
function markFirst(shelf, options) {
  const first = Object.keys(options)[0];
  shelf[first] = 7;
  return shelf;
}
say("first", markFirst(new Shelf(), { size: 3 }), markFirst(new Shelf(), {}), markFirst(new Shelf(), {}).undefined);
function markLast(shelf, options, back) {
  const names = Object.keys(options);
  shelf[names[names.length - back]] = 5;
  return shelf;
}
say("last", markLast(new Shelf(), { size: 3, label: 2 }, 1), markLast(new Shelf(), {}, 1), markLast(new Shelf(), { size: 1 }, 0));

// A loop that ends by the length, beside a store that does not, and a loop that goes one too far.
function copyAll(source) {
  const names = Object.keys(source);
  const copy = new Shelf();
  for (let i = 0; i < names.length; i++) copy[names[i]] = source[names[i]];
  copy[names[names.length]] = "behind";
  return copy;
}
say("copy", copyAll({ size: 4, label: "x" }), copyAll({ size: 4 }));
function copyTooFar(source) {
  const names = Object.keys(source);
  const copy = { size: 0, label: "" };
  for (let i = 0; i <= names.length; i++) copy[names[i]] = source[names[i]];
  return copy;
}
const tooFar = copyTooFar({ size: 4, label: "x" });
say("too far", Object.keys(tooFar).join(), "undefined" in tooFar, tooFar.undefined);
function copyBackwards(source) {
  const names = Object.keys(source);
  const copy = new Shelf();
  for (let i = names.length; i >= 0; i--) copy[names[i]] = source[names[i]];
  return copy;
}
say("backwards", Object.keys(copyBackwards({ label: "y", size: 2 })).join(), copyBackwards({ size: 2 }).size);

// Own names.
function markOwn(shelf, options) {
  const names = Object.getOwnPropertyNames(options);
  shelf[names[1]] = 6;
  return shelf;
}
say("own", markOwn(new Shelf(), { label: 1, size: 2 }), markOwn(new Shelf(), { label: 1 }), markOwn(new Shelf(), {}));

// A read of a table that holds the name, of one that does not, of an object that inherits it, and of the listed object.
const table = { size: 1, label: 2, undefined: "spelled" };
const bare = { size: 1, label: 2 };
class Above {
  get undefined() {
    return "above";
  }
}
class Below extends Above {
  constructor() {
    super();
    this.size = 10;
    this.label = 20;
  }
}
const lookInTable = options => table[Object.keys(options)[0]];
const lookInBare = options => bare[Object.keys(options)[0]];
const lookBelow = options => new Below()[Object.keys(options)[0]];
function lookInItself(options) {
  const found = options[Object.keys(options)[0]];
  return found === undefined ? "none" : found + 1;
}
for (const options of [{ size: 0 }, { label: 0 }, {}]) say("look", lookInTable(options), lookInBare(options), lookBelow(options), lookInItself(options));

// Methods.
const doers = {
  size() {
    return "sizes";
  },
  label() {
    return "labels";
  },
};
function run(options) {
  const doer = doers[Object.keys(options)[0]];
  return typeof doer === "function" ? doer.call(doers) : typeof doer;
}
say("run", run({ size: 0 }), run({ label: 0 }), run({}));

// With something in front of the name.
const affixed = { onsize: 1, onlabel: 2, onundefined: "spelled" };
const taken = { onsize: 0, onlabel: 0 };
for (const options of [{ size: 0 }, { label: 0 }, {}]) {
  say("affixed", affixed["on" + Object.keys(options)[0]]);
  taken["on" + Object.keys(options)[0]] = 3;
}
say("taken", taken);

// Definitions, also where some names do not come to them.
function defineFirst(options) {
  const made = new Shelf();
  Object.defineProperty(made, Object.keys(options)[0], { value: 9, enumerable: true, configurable: true, writable: true });
  return made;
}
say("define", defineFirst({ size: 0 }), defineFirst({}));
function defineOthers(options, place) {
  const made = new Shelf();
  const name = Object.keys(options)[place];
  switch (name) {
    case "size":
    case "label":
      return made;
  }
  Object.defineProperty(made, name, { value: 8, enumerable: true, configurable: true, writable: true });
  return made;
}
say("others", defineOthers({ size: 0, label: 0 }, 0), defineOthers({ size: 0, label: 0 }, 1), defineOthers({ size: 0, label: 0 }, 2));

// `in`, `delete`, and the stores of a module's own code.
say("in", [{ size: 0 }, {}].map(options => Object.keys(options)[0] in table).join(), [{ size: 0 }, {}].map(options => Object.keys(options)[0] in bare).join());
const shrinking = { size: 1, undefined: 2 };
delete shrinking[Object.keys({ nothing: 1 }.nothing === 1 ? {} : { size: 1 })[0]];
say("delete", shrinking);
const gathered = {};
for (const options of [{ size: 0 }, {}, { label: 1 }]) gathered[Object.keys(options)[0]] = Object.keys(options).length;
say("gathered", gathered, gathered.undefined);
