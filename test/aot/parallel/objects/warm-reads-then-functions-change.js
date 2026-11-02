"use strict";
// Functions of every kind as receivers of reads by name, at sites that see them all, 200 times over; then they get, hide and lose properties, and stand below other objects.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
function declared(a, b) {
  return a + b;
}
class Plain {
  method(a) {
    return a;
  }
}
class WithStatics {
  static call = "a static field named call";
  static tag = "a static tag";
  static toString() {
    return "a static toString";
  }
  static get listener() {
    return "a static getter";
  }
  static bind(a, b, c) {
    return "a static method named bind";
  }
}
class Heir extends WithStatics {
  static own = "own of the heir";
}
const otherPrototype = { call: "otherPrototype.call", marker: "otherPrototype.marker" };
const makers = {
  arrow: () => (a, b, c) => a,
  capturing: () => {
    const captured = unknown;
    return () => captured;
  },
  declared: () => declared,
  expression: () => function named(a) {},
  anonymous: () => (0, function () {}),
  method: () => new Plain().method,
  shorthand: () => ({ short(a, b) {} }).short,
  getter: () => Object.getOwnPropertyDescriptor({ get got() { return 1; } }, "got").get,
  asynchronous: () => async function later(a) {},
  generator: () => function* many(a, b) {},
  bound: () => declared.bind(null, 1),
  boundTwice: () => declared.bind(null).bind(null, 1, 2),
  plainClass: () => Plain,
  classWithStatics: () => WithStatics,
  heir: () => Heir,
  freshClass: () => class Fresh { static call = "call of a fresh class"; },
  host: () => Math.max,
  hostMethod: () => [].push,
  constructorOfHost: () => Map,
  fromText: () => new Function("a", "b", "return a" + unknown),
  withProperties: () => Object.assign(function decorated() {}, { tag: "own tag", listener: "own listener" }),
};
const readers = {
  name: o => o.name,
  length: o => o.length,
  prototype: o => typeof o.prototype,
  prototypeIsKept: o => o.prototype === o.prototype,
  call: o => o.call,
  apply: o => o.apply,
  bind: o => o.bind,
  toString: o => o.toString,
  constructor: o => o.constructor,
  hasInstance: o => o[Symbol.hasInstance],
  tag: o => o.tag,
  listener: o => o.listener,
  own: o => o.own,
  marker: o => o.marker,
  then: o => o.then,
  displayName: o => o.displayName,
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
const outcomes = [];
const attemptOnEach = (receivers, change) => {
  const failed = [];
  for (const [kind, receiver] of receivers) {
    try {
      change(receiver);
    } catch (error) {
      failed.push(kind + " " + error.constructor.name);
    }
  }
  return failed.length ? failed.join(", ") : "done";
};
// What is shared by every round stays as it is: the steps change functions made for them alone.
const isFresh = kind => !["declared", "plainClass", "classWithStatics", "heir", "host", "hostMethod", "constructorOfHost"].includes(kind);

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const fresh = receivers.filter(([kind]) => isFresh(kind));
const steps = [
  ["they get a property", () => attemptOnEach(fresh, f => { f.tag = "tag stored"; })],
  ["a property of their own hides what Function.prototype has", () => attemptOnEach(fresh, f => { f.call = "own call"; f.then = "own then"; })],
  ["the name and the length are defined anew", () => attemptOnEach(fresh, f => { Object.defineProperty(f, "name", { value: "renamed" }); Object.defineProperty(f, "length", { value: 99 }); })],
  ["the name and the length are deleted", () => attemptOnEach(fresh, f => { delete f.name; delete f.length; })],
  ["the prototype property is stored", () => attemptOnEach(fresh, f => { f.prototype = { stored: true }; })],
  ["the properties are deleted", () => attemptOnEach(fresh, f => { delete f.tag; delete f.call; delete f.then; })],
  ["they stand below another object", () => attemptOnEach(fresh, f => { Object.setPrototypeOf(f, otherPrototype); })],
  ["that object changes", () => { otherPrototype.call = "changed"; otherPrototype.tag = "otherPrototype.tag"; delete otherPrototype.marker; return "done"; }],
  ["below Function.prototype again, frozen", () => attemptOnEach(fresh, f => { Object.freeze(Object.setPrototypeOf(f, Function.prototype)); })],
  ["the statics of a class change", () => { WithStatics.tag = "tag changed"; delete WithStatics.call; WithStatics.marker = "a new static"; Object.defineProperty(WithStatics, "listener", { value: "a value now", configurable: true }); return "done"; }],
  ["the heir hides and gets statics", () => { Heir.tag = "tag of the heir"; Heir.call = "call of the heir"; delete Heir.own; return "done"; }],
  ["the heir stands below another class", () => { Object.setPrototypeOf(Heir, Plain); return "done"; }],
];
for (const [what, change] of steps) {
  console.log("\n--- " + what + ": " + change());
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const again = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\n- new ones\n" + again);
  }
}
