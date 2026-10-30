// Members defined while nobody can see the class.
const lines = [];
const note = (...parts) => lines.push(parts.map(String).join(" | "));
const keysOf = object => Reflect.ownKeys(object).map(String).join();

// The methods take variables of the function around the class, so the definition makes them one after the other.
function define(step, extra) {
  const offset = step * 10;
  let calls = 0;
  const watched = [];
  class Base {
    first() { calls++; return "first" + offset; }
    second() { return this.first() + "/second" + offset; }
    get both() { return "got" + offset; }
    third() { return "third" + calls; }
    set both(value) { watched.push(value + offset); }
    first() { calls++; return "first again" + offset; }
    static make() { return new this(); }
    static get count() { return calls; }
    static first() { return "static first" + offset; }
    [extra]() { return extra + offset; }
    last() { return watched.join("+"); }
  }
  return Base;
}

function use(Class, extra, rounds) {
  const made = Class.make();
  let out = "";
  for (let i = 0; i < rounds; i++) out = [made.first(), made.second(), typeof made.both === "function" ? "a function" : made.both, made.third(), made[extra](), Class.first(), Class.count].join();
  made.both = "stored";
  return out + " " + made.last();
}

const classes = [define(1, "added"), define(2, "first"), define(3, "constructor"), define(4, "both")];
["added", "first", "constructor", "both"].forEach((extra, index) => {
  const Class = classes[index];
  note(keysOf(Class.prototype), keysOf(Class));
  try { note(use(Class, extra, 5)); } catch (error) { note("threw", error.constructor.name, error.message); }
});
note(classes[0].prototype.first === classes[1].prototype.first, classes[0].prototype.constructor === classes[0]);

// What the keys of a definition can do while it runs: the class has no name yet, and what is above it can change.
function Above() {}
Above.prototype.inherited = function () { return "from above"; };
Above.prototype.hidden = function () { return "hidden above"; };
const order = [];
let early;
class Watched extends Above {
  [(order.push("one"), "one")]() { return 1; }
  [(() => { try { return Watched.name; } catch (error) { order.push(error.constructor.name); return "two"; } })()]() { return 2; }
  [(Above.prototype.inherited = function () { return "changed during the definition"; }, "three")]() { return this.inherited(); }
  [(early = Object.create(Above.prototype), "hidden")]() { return "hidden below"; }
  static [(order.push("static"), "four")]() { return 4; }
  get [(order.push("getter"), "five")]() { return 5; }
}
const watched = new Watched();
note(order.join(), keysOf(Watched.prototype), keysOf(Watched));
note(watched.one(), watched.two(), watched.three(), watched.hidden(), early.hidden(), Watched.four(), watched.five);

// A key that throws leaves nothing behind, and the next evaluation starts over.
function defineOrThrow(fails) {
  const tag = fails ? "failed" : "whole";
  return class Half {
    before() { return "before " + tag; }
    [fails ? (() => { throw new RangeError("key"); })() : "middle"]() { return "middle " + tag; }
    after() { return "after " + tag; }
  };
}
for (const fails of [true, false, true, false]) {
  try { const Half = defineOrThrow(fails); const half = new Half(); note(half.before(), half.middle(), half.after(), keysOf(Half.prototype)); } catch (error) { note("threw", error.message); }
}

// Calls that rest on the members as they were defined see every change that comes later.
function family(seed) {
  class Root {
    value() { return "root" + seed; }
    twice() { return this.value() + this.value(); }
    get read() { return "read" + seed; }
    static kind() { return "Root" + seed; }
  }
  class Middle extends Root {
    other() { return "other" + seed; }
  }
  class Leaf extends Middle {
    leaf() { return this.twice() + this.read + seed; }
    static which() { return this.kind(); }
  }
  return { Root, Middle, Leaf };
}
const { Root, Middle, Leaf } = family(7);
const leaf = new Leaf();
const changes = [
  () => {},
  () => { Root.prototype.value = function () { return "replaced"; }; },
  () => { Middle.prototype.value = function () { return "hides"; }; },
  () => { delete Middle.prototype.value; },
  () => { Object.defineProperty(Root.prototype, "read", { get() { return "other getter"; }, configurable: true }); },
  () => { Object.defineProperty(Leaf.prototype, "read", { value: "a value", configurable: true }); },
  () => { Root.kind = () => "replaced kind"; },
  () => { Middle.kind = () => "middle kind"; },
  () => { Object.setPrototypeOf(Leaf, Root); },
  () => { Object.setPrototypeOf(Leaf.prototype, Root.prototype); },
  () => { Object.setPrototypeOf(Middle.prototype, { value() { return "elsewhere"; }, twice() { return "twice elsewhere"; } }); Object.setPrototypeOf(Leaf.prototype, Middle.prototype); },
  () => { leaf.twice = () => "own"; },
  () => { delete Root.prototype.twice; delete leaf.twice; },
];
for (const change of changes) {
  change();
  let out = "";
  for (let i = 0; i < 4; i++) { try { out = leaf.leaf() + " " + Leaf.which(); } catch (error) { out = "threw " + error.constructor.name; } }
  note(out);
}

// One side of a class is looked at, then the other side is changed.
function sides(seed) {
  return class Sides {
    method() { return "method" + seed; }
    run() { return this.method(); }
    static method() { return "static" + seed; }
    static run() { return this.method(); }
  };
}
for (const look of [C => Reflect.ownKeys(C.prototype), C => Reflect.ownKeys(C), C => Object.getOwnPropertyDescriptors(C.prototype), C => Object.keys(C), C => C.prototype.method.name, C => C.method.name]) {
  const Sides = sides(lines.length);
  const one = new Sides();
  let out = "";
  for (let i = 0; i < 3; i++) out = one.run() + Sides.run();
  look(Sides);
  for (let i = 0; i < 3; i++) out += one.run() + Sides.run();
  Sides.method = () => "new static";
  for (let i = 0; i < 3; i++) out = out + "," + one.run() + Sides.run();
  Sides.prototype.method = () => "new method";
  for (let i = 0; i < 3; i++) out = out + "," + one.run() + Sides.run();
  note(out);
}

// A static method and a static field of one name, either way round.
class MethodThenField { static same() { return "method"; } static same = "field"; static read() { return typeof this.same; } }
class FieldThenMethod { static same = "field"; static same() { return "method"; } static read() { return typeof this.same; } }
for (let i = 0; i < 3; i++) note(MethodThenField.read(), FieldThenMethod.read(), keysOf(MethodThenField), keysOf(FieldThenMethod));

console.log(lines.join("\n"));
