// Warm reads of crowded receivers then the prototype object of a class is written.
"use strict";
// Each receiver has forty names more of its own: reads by name of many kinds of receivers at sites that see them all, 200 times over; then the prototype objects of classes are written; then the same reads again, of the same objects and of new ones.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
class Base {
  constructor() {
    this.own = "own";
  }
  method() {
    return "Base.method";
  }
  shared() {
    return "Base.shared";
  }
  get getter() {
    return "Base.getter";
  }
}
class Derived extends Base {
  method() {
    return "Derived.method";
  }
}
class OtherBase {
  shared() {
    return "OtherBase.shared";
  }
  added() {
    return "OtherBase.added";
  }
}
function Old() {
  this.own = "own";
}
Old.prototype.method = function oldMethod() {};
Old.prototype.value = "Old.value";
const top = { value: "top.value", hidden: "top.hidden", method: function topMethod() {} };
const middle = Object.setPrototypeOf({ hidden: "middle.hidden", middleOnly: "middle.only" }, top);
const otherTop = { value: "otherTop.value", added: "otherTop.added" };
const makers = {
  parsed: () => Object.setPrototypeOf(JSON.parse('{"own":"own","n":1}'), middle),
  created: () => Object.assign(Object.create(middle), { own: "own" }),
  belowTop: () => Object.defineProperty(Object.assign(Object.create(top), { own: "own" }), "hidden", { value: "own hidden", writable: true, enumerable: true, configurable: true }),
  plain: () => JSON.parse('{"own":"own"}'),
  instance: () => new Derived(),
  base: () => new Base(),
  instanceWithMore: () => Object.assign(new Derived(), { ["more" + unknown]: 1 }),
  old: () => new Old(),
  literal: () => ({ own: "own", value: "literal.value" }),
  bare: () => Object.assign(Object.create(null), { own: "own" }),
};
for (const kind of Object.keys(makers)) {
  const make = makers[kind];
  makers[kind] = () => {
    const made = make();
    for (let i = 0; i < 40; i++) made["filler" + i + unknown] = i;
    return made;
  };
}
const readers = {
  own: o => o.own,
  value: o => o.value,
  hidden: o => o.hidden,
  middleOnly: o => o.middleOnly,
  method: o => o.method,
  shared: o => o.shared,
  getter: o => o.getter,
  added: o => o.added,
  toString: o => o.toString,
  constructor: o => o.constructor,
  zero: o => o[0],
  zeroAsText: o => o["0"],
  proto: o => o.__proto__ === Object.getPrototypeOf(o),
};
const show = value => (typeof value === "function" ? "function " + value.name : String(value));
const makeAll = () => Object.entries(makers).map(([kind, make]) => [kind, make()]);
function readAll(receivers) {
  const lines = [];
  for (const [kind, receiver] of receivers) {
    const words = [];
    for (const name in readers) words.push(name + "=" + show(readers[name](receiver)));
    lines.push(kind + ": " + words.join(" "));
  }
  return lines.join("\n");
}

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const steps = [
  ["the base gets a name", () => { Base.prototype.added = "Base.added"; }],
  ["the heir gets a method that hides the base's", () => { Derived.prototype.shared = function derivedShared() {}; }],
  ["a method of the base is replaced", () => { Base.prototype.method = function secondBaseMethod() {}; Base.prototype.shared = function secondBaseShared() {}; }],
  ["methods are deleted", () => { delete Derived.prototype.method; delete Derived.prototype.shared; delete Base.prototype.added; }],
];
for (const [what, change] of steps) {
  change();
  console.log("\n--- " + what);
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const fresh = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\n- new objects\n" + fresh);
  }
}
