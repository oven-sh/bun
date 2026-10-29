// Keys that no keyed cache serves (strings built anew, the first uses of a key cell, symbols) get, test and set properties of every kind of receiver as in plain Bun.
import * as self from "./computed-keys-without-caches.js";

export function k0() {}
export var k1 = "var export";
export let k2 = "let export";

const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
const rounds = JSON.parse("70");
const mark = Symbol("mark");
const symbols = [mark, Symbol("unused"), Symbol.iterator, Symbol.toStringTag];
const storeSloppily = new Function("object", "key", "value", "object[key] = value;");
const calls = { getter: 0, setter: 0, getTrap: 0, hasTrap: 0, setTrap: 0 };

function show(value) {
  if (typeof value === "function" || typeof value === "symbol") return typeof value;
  return typeof value === "object" && value !== null ? "object" : String(value);
}
function get(object, key) { try { return show(object[key]); } catch (error) { return error.constructor.name; } }
function has(object, key) { try { return key in object ? "yes" : "no"; } catch (error) { return error.constructor.name; } }
function set(object, key, value) { try { object[key] = value; return "stored"; } catch (error) { return error.constructor.name; } }
function setSloppily(object, key, value) { try { storeSloppily(object, key, value); return "stored"; } catch (error) { return error.constructor.name; } }
function keysOf(object) { try { return Object.keys(object).join(",") || "none"; } catch (error) { return error.constructor.name; } }

function repeated(times, access) {
  const answer = access();
  for (let i = 1; i < times; i++) {
    const next = access();
    if (next !== answer) return answer + " then " + next + " at " + i;
  }
  return answer;
}
function withFreshKeys(access) {
  const answers = [];
  for (let i = 0; i < rounds; i++) {
    const answer = access("k" + (i % 7), i);
    if (i < 7) answers.push(answer);
    else if (answers[i % 7] !== answer) return "k" + (i % 7) + ": " + answers[i % 7] + " then " + answer + " at " + i;
  }
  return answers.join(",");
}
function withNamelessKeys(access) {
  let i = 0;
  return repeated(rounds, () => access("nameless" + i++));
}
function withEachKey(keys, access) {
  return keys.map(key => repeated(100, () => access(key))).join(",");
}

function report(object, cells) {
  const read = key => get(object, key);
  const test = key => has(object, key);
  console.log("  get: " + withFreshKeys(read) + " | " + withEachKey(cells, read) + " | " + withEachKey(symbols, read) + " | " + withNamelessKeys(read));
  console.log("  in: " + withFreshKeys(test) + " | " + withEachKey(cells, test) + " | " + withEachKey(symbols, test) + " | " + withNamelessKeys(test));
}
function exercise(name, object) {
  const cells = [];
  for (let n = 0; n < 7; n++) cells.push("k" + hidden(n));
  cells.push("only on " + hidden(name));
  console.log(name);
  report(object, cells);
  console.log("  set: " + withFreshKeys((key, i) => set(object, key, i % 7)) + " | " + withEachKey(cells, key => set(object, key, "again")) + " | " + withEachKey(symbols, key => set(object, key, "by symbol")));
  report(object, cells);
  console.log("  keys: " + keysOf(object));
}
function exerciseSloppyStores(name, object) {
  console.log(name + ", sloppy stores: " + withFreshKeys((key, i) => setSloppily(object, key, i % 7)) + " | " + withFreshKeys(key => get(object, key)) + " | " + keysOf(object));
}
function exerciseSpecialKeys(name, object) {
  const special = [
    ["__proto__", () => hidden("__pro") + "to__", { k6: "from the new prototype" }],
    ["0", () => String(hidden(0)), "at zero"],
    ["empty", () => hidden("x").slice(1), "at the empty key"],
  ];
  for (const [label, createKey, value] of special) {
    const look = () => get(object, createKey()) + " " + has(object, createKey());
    console.log(name + ", key " + label + ": " + repeated(20, look) + " | " + repeated(20, () => set(object, createKey(), value)) + " | " + repeated(20, look));
  }
  console.log(name + ", afterwards: " + get(object, "k" + hidden(6)) + " | " + keysOf(object));
}

class Shape {
  static k0() { return "static method"; }
  static k1 = "static field";
  static other() {}
}
class Point {
  constructor() {
    this.k0 = 1.5;
    this.k1 = "field";
    this.k2 = () => this.k0;
  }
  k3() { return "method"; }
}
function plain() {}
plain.k3 = "on a function";
function createClosure(captured) { return function closure() { return captured; }; }
function createPoint() {
  const point = new Point();
  point[hidden("k4")] = "extra property";
  return point;
}
function createDictionary() {
  const dictionary = {};
  for (let i = 0; i < 200; i++) dictionary["d" + i] = i;
  dictionary.k1 = "in a dictionary";
  delete dictionary.d7;
  return dictionary;
}
function createArray() {
  const array = [10, 20, 30];
  array.k2 = "named";
  return array;
}
function createBare() {
  const bare = Object.create(null);
  bare.k5 = "bare";
  return bare;
}
const handler = {
  get(target, key) { calls.getTrap++; return "trapped"; },
  has(target, key) { calls.hasTrap++; return typeof key === "symbol"; },
  set(target, key, value) { calls.setTrap++; return true; },
};
const frozenPrototype = Object.freeze({ k0: "frozen k0", k1: "frozen k1", [mark]: "frozen mark" });
const setterPrototype = { set k1(value) { calls.setter++; }, k2: "inherited" };
const readOnlyPrototype = Object.defineProperty({}, "k2", { value: "read-only", enumerable: true });

const receivers = [
  ["literal", () => ({ k0: "zero", k1: 1, k2: null, [mark]: "marked" })],
  ["parsed", () => JSON.parse('{"k0":"zero","k3":3,"other":true}')],
  ["dictionary", createDictionary],
  ["array", createArray],
  ["function", () => plain],
  ["closure", () => createClosure(1)],
  ["class", () => Shape],
  ["instance", createPoint],
  ["null prototype", createBare],
  ["frozen", () => Object.freeze({ k0: "frozen", k6: 6 })],
  ["under a frozen prototype", () => Object.create(frozenPrototype)],
  ["namespace during evaluation", () => self],
  ["proxy", () => new Proxy({}, handler)],
  ["getter", () => ({ get k0() { calls.getter++; return "computed"; }, k1: "beside a getter" })],
  ["setter on the prototype", () => Object.create(setterPrototype)],
  ["read-only inherited", () => Object.create(readOnlyPrototype)],
];
for (const [name, create] of receivers) exercise(name, create());
for (const [name, create] of receivers) exerciseSloppyStores(name, create());
for (const [name, create] of receivers) exerciseSpecialKeys(name, create());
console.log("calls: " + Object.keys(calls).map(name => name + " " + calls[name]).join(", "));

const shadowing = Object.create(frozenPrototype);
const shadowedKey = "k" + hidden(0);
console.log("inherited from a frozen prototype: " + withEachKey([shadowedKey], key => get(shadowing, key)));
Object.defineProperty(shadowing, shadowedKey, { value: "own k0" });
console.log("shadowed by a definition: " + withEachKey([shadowedKey], key => get(shadowing, key)));

k2 = "let export stored again";
Promise.resolve().then(() => exercise("namespace after evaluation", self));
export const k5 = "const export";
export class k6 {}
