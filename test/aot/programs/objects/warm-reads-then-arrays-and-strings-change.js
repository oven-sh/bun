"use strict";
// Strings, arrays, regular expressions, numbers and booleans as receivers of reads by name, at sites that see them all, 200 times over; then the arrays and what is above them change.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
class List extends Array {
  first() {
    return this[0];
  }
  get size() {
    return this.length;
  }
}
const otherPrototype = { map: "otherPrototype.map", marker: "otherPrototype.marker", 1: "otherPrototype[1]" };
const makers = {
  text: () => "text" + unknown,
  emptyText: () => "" + unknown,
  rope: () => "a long piece of text, " + unknown + "joined to another long piece of text",
  wrappedText: () => new String("wrapped"),
  integers: () => [1, 2, 3],
  doubles: () => [1.5, 2.5],
  objects: () => [{}, "x", null],
  empty: () => [],
  holes: () => [1, , 3],
  matched: () => /(?<word>b+)/.exec("abbbc"),
  list: () => List.from([7, 8]),
  pattern: () => /x+/g,
  integer: () => 7,
  double: () => 7.25,
  truth: () => true,
  plain: () => ({ length: "own length", 0: "plain[0]" }),
};
const readers = {
  length: o => o.length,
  slice: o => o.slice,
  indexOf: o => o.indexOf,
  map: o => o.map,
  push: o => o.push,
  at: o => o.at,
  index: o => o.index,
  input: o => o.input,
  groups: o => o.groups,
  first: o => o.first,
  size: o => o.size,
  lastIndex: o => o.lastIndex,
  source: o => o.source,
  global: o => o.global,
  toFixed: o => o.toFixed,
  valueOf: o => o.valueOf,
  toString: o => o.toString,
  constructor: o => o.constructor,
  then: o => o.then,
  marker: o => o.marker,
  extra: o => o.extra,
  zero: o => o[0],
  zeroAsText: o => o["0"],
  oneAsText: o => o["1"],
  sliced: o => (typeof o.slice === "function" ? o.slice(0, 2) : "no slice"),
};
const show = value => (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
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
const attempt = change => {
  try {
    change();
    return "done";
  } catch (error) {
    return error.constructor.name;
  }
};
const arraysOf = receivers => receivers.map(([, receiver]) => receiver).filter(Array.isArray);

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const steps = [
  ["the arrays get a property of their own", () => { for (const array of arraysOf(receivers)) array.extra = "own extra"; }],
  ["a property of their own hides a method", () => { for (const array of arraysOf(receivers)) { array.map = "own map"; array.then = "own then"; } }],
  ["they grow and shrink", () => { for (const array of arraysOf(receivers)) { for (let i = 0; i < 100; i++) array.push(i); array.length = 2; } }],
  ["they hold other kinds of elements", () => { for (const array of arraysOf(receivers)) { array[0] = "a string"; array[1] = 2.5; } }],
  ["an element far away", () => { for (const array of arraysOf(receivers)) array[100000] = "far"; }],
  ["the properties are deleted", () => { for (const array of arraysOf(receivers)) { delete array.map; delete array.then; delete array.extra; array.length = 3; } }],
  ["the class above a list gets and loses members", () => { List.prototype.marker = "List.marker"; delete List.prototype.first; Object.defineProperty(List.prototype, "size", { value: "a value now", configurable: true }); }],
  ["the arrays stand below another object", () => { for (const array of arraysOf(receivers)) Object.setPrototypeOf(array, otherPrototype); }],
  ["that object changes", () => { otherPrototype.map = "changed"; otherPrototype.extra = "otherPrototype.extra"; delete otherPrototype.marker; }],
  ["below Array.prototype again, frozen", () => { for (const array of arraysOf(receivers)) Object.freeze(Object.setPrototypeOf(array, Array.prototype)); }],
  ["the expression has matched", () => { for (const [, receiver] of receivers) if (receiver instanceof RegExp) receiver.test("axxb"); }],
  ["the wrapped text gets a property", () => { for (const [, receiver] of receivers) if (receiver instanceof String) receiver.extra = "extra of the wrapper"; }],
];
for (const [what, change] of steps) {
  console.log("\n--- " + what + ": " + attempt(change));
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const fresh = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\n- new ones\n" + fresh);
  }
}
