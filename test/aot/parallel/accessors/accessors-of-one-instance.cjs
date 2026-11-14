// A constructor defines an accessor on the object that it makes, and something else is done to one instance, one heir or one list from outside.
"use strict";
const lines = [];
const say = (...all) => lines.push(all.join(" "));
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
const pair = value => ({ configurable: true, enumerable: true, get: () => value, set(x) { say("outside", x); } });
class Box {
  constructor(v) {
    this.v = v;
    Object.defineProperty(this, "size", { configurable: true, enumerable: true, get() { return this.v; }, set(x) { this.v = x * 2; } });
  }
}
class Fixed {
  constructor(v) {
    this.v = v;
    Object.defineProperty(this, "size", { get() { return this.v; } });
  }
}
class Heir extends Box {
  constructor(v) {
    super(v);
    this.own = 1;
  }
}
class HeirWithField extends Box {
  size = "field";
}
class HeirWithGetter extends Box {
  get size() {
    return "above";
  }
}
class Early {
  constructor(kept) {
    this.v = 1;
    kept.push(this);
    Object.defineProperty(this, "size", { configurable: true, get() { return this.v + 100; } });
  }
}
class Sometimes {
  constructor(v) {
    this.v = v;
    if (v & 1) Object.defineProperty(this, "size", { configurable: true, get() { return this.v; }, set(x) { this.v = x; } });
  }
}
const Mixed = Base => class extends Base {
  constructor(v) {
    super(v);
    Object.defineProperty(this, "size", { configurable: true, get() { return "mixed" + this.v; } });
  }
};
const MixedBox = Mixed(Box);
function Called(v) {
  this.v = v;
  Object.defineProperty(this, "size", { configurable: true, get() { return this.v; }, set(x) { this.v = x + 1; } });
}
function Child(v) {
  Called.call(this, v);
  this.child = 1;
}
Child.prototype = Object.create(Called.prototype);
function sum(list) {
  let text = "";
  for (let turn = 0; turn < 3; turn++) {
    for (const one of list) {
      text += attempt(() => one.size) + ",";
      attempt(() => { one.size = turn; });
      text += attempt(() => one.size) + ";";
    }
  }
  return text;
}
const makers = [
  ["Box", v => new Box(v)],
  ["Fixed", v => new Fixed(v)],
  ["Heir", v => new Heir(v)],
  ["HeirWithField", v => new HeirWithField(v)],
  ["HeirWithGetter", v => new HeirWithGetter(v)],
  ["Sometimes", v => new Sometimes(v)],
  ["MixedBox", v => new MixedBox(v)],
  ["Called", v => new Called(v)],
  ["Child", v => new Child(v)],
  ["Reflect", v => Reflect.construct(Box, [v], Heir)],
];
const changes = [
  ["nothing", () => {}],
  ["pair", one => Object.defineProperty(one, "size", pair(40))],
  ["value", one => Object.defineProperty(one, "size", { value: "value", writable: true, configurable: true })],
  ["legacy", one => one.__defineGetter__("size", () => 41)],
  ["delete", one => { delete one.size; }],
  ["store", one => { delete one.size; one.size = 42; }],
  ["assign", one => Object.assign(one, { size: 9 })],
  ["prototype", one => Object.setPrototypeOf(one, { get size() { return 43; } })],
  ["freeze", one => Object.freeze(one)],
  ["key", one => { one[["si", "ze"].join("")] = 11; }],
];
for (const [name, make] of makers) {
  for (const [change, apply] of changes) {
    const list = [make(1), make(2), make(3)];
    say(name, change, attempt(() => apply(list[1])) === "undefined" ? "" : "gave");
    say(sum(list));
    say(list.map(one => Object.keys(one).join("/")).join(), attempt(() => make(5).size));
  }
}
const kept = [];
const early = new Early(kept);
say(early.size, kept[0] === early, attempt(() => kept[0].size));
const one = new Box(1), two = new Box(2);
Object.defineProperty(two, "size", pair("only two"));
let total = 0;
for (let turn = 0; turn < 20; turn++) {
  one.size = turn & 3;
  total += one.size;
}
say(total, one.size, two.size, JSON.stringify(one), JSON.stringify(two));
console.log(lines.join("\n"));
