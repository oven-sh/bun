// The program's own callers hand `area` a literal with a width and a height, `describe` a Box, and `each` an arrow function. All three hang on the global object, so text evaluated at run time, built-ins,
// bound functions and another realm call them too, with anything.
const vm = require("node:vm");
class Box {
  constructor(width, height) { this.width = width; this.height = height; }
  get size() { return this.width * this.height; }
  name() { return "box"; }
}
class Crate extends Box {
  name() { return "crate"; }
}
function area(shape) { return shape.width * shape.height; }
function describe(box) { return box.name() + " " + box.size + " " + box.width; }
function each(visit, count) { let sum = 0; for (let index = 0; index < count; index++) sum += visit(index); return sum; }
function self() { return this.width + ":" + typeof this; }
globalThis.area = area; globalThis.describe = describe; globalThis.each = each; globalThis.self = self; globalThis.Box = Box;

const lines = [];
function attempt(label, run) {
  try { lines.push(label + " " + String(run())); } catch (error) { lines.push(label + " threw " + error.constructor.name); }
}
let seen = 0;
for (let turn = 0; turn < 2000; turn++) seen += area({ width: turn, height: 2 }) + describe(new Box(turn, 1)).length + each(index => index + turn, 3) + self.call({ width: turn, height: 0 }).length;
lines.push("own callers " + seen);

let reads = 0;
const strangers = {
  "fields the other way round": { height: 3, width: 2 },
  "one field more": { width: 2, depth: 9, height: 3 },
  "one field missing": { width: 2 },
  "strings in the fields": { width: "2", height: "3" },
  "a bigint in a field": { width: 2n, height: 3 },
  "getters": { get width() { reads++; return 4; }, get height() { reads++; return 5; } },
  "fields on the prototype": Object.create({ width: 6, height: 7 }),
  "no prototype": Object.assign(Object.create(null), { width: 8, height: 9 }),
  "a box": new Box(2, 5),
  "a crate": new Crate(3, 5),
  "a box with another prototype": Object.setPrototypeOf(new Box(2, 5), { name() { return "other"; }, size: -1 }),
  "a box that lost a field": (() => { const box = new Box(2, 5); delete box.width; return box; })(),
  "a frozen literal": Object.freeze({ width: 2, height: 2 }),
  "a proxy": new Proxy({ width: 1, height: 1 }, { get(target, key) { return key === "width" ? 10 : key === "height" ? 11 : target[key]; } }),
  "an array": [1, 2],
  "a function": Object.assign(function () {}, { width: 12, height: 2 }),
  "a string": "text",
  "a number": 7,
  "a symbol": Symbol("s"),
  "true": true,
  "null": null,
  "undefined": undefined,
  "an object of another realm": vm.runInNewContext("({ width: 13, height: 2, name() { return 'far'; }, size: 26 })"),
  "data from outside": JSON.parse('{"width":14,"height":2}'),
};
const roads = {
  "directly": (callee, value) => callee(value),
  "by call": (callee, value) => callee.call(undefined, value),
  "by apply": (callee, value) => callee.apply(null, [value]),
  "by Reflect.apply": (callee, value) => Reflect.apply(callee, undefined, [value]),
  "bound": (callee, value) => callee.bind(null, value)(),
  "by map": (callee, value) => [value].map(callee)[0],
  "by evaluated text": (callee, value) => { globalThis.handed = value; return (0, eval)(callee.name + "(handed)"); },
  "by a function out of text": (callee, value) => new Function("value", "return " + callee.name + "(value)")(value),
  "out of another realm": (callee, value) => vm.runInNewContext("callee(value)", { callee, value }),
  "as a reviver's helper": (callee, value) => JSON.parse("[0]", (key, item) => (key === "0" ? callee(value) : item))[0],
};
for (const [road, take] of Object.entries(roads)) {
  for (const [label, value] of Object.entries(strangers)) {
    attempt(road + " area " + label, () => take(area, value));
    attempt(road + " describe " + label, () => take(describe, value));
  }
}
for (const [label, value] of Object.entries(strangers)) {
  attempt("this " + label, () => self.call(value));
  attempt("this bound " + label, () => self.bind(value)());
  attempt("each " + label, () => each(value, 2));
}
attempt("each a bound function", () => each(area.bind(null, { width: 2, height: 2 }), 2));
attempt("each a built-in", () => each(Math.sqrt, 5));
attempt("each a class", () => each(Box, 1));
attempt("each an async function", () => typeof each(async index => index, 1));
attempt("each a generator function", () => typeof each(function* () {}, 1));
attempt("each a proxy of a function", () => each(new Proxy(index => index, { apply() { return 100; } }), 2));
attempt("each a function of another realm", () => each(vm.runInNewContext("index => index * 3"), 3));
attempt("constructed", () => typeof new area({ width: 1, height: 1 }));
attempt("no argument", () => area());
attempt("more arguments", () => area({ width: 2, height: 2 }, 1, 2, 3));
for (let turn = 0; turn < 2000; turn++) seen += area({ width: turn, height: 2 }) + describe(new Box(turn, 1)).length;
lines.push("own callers again " + seen + " reads " + reads);
console.log(lines.join("\n"));
