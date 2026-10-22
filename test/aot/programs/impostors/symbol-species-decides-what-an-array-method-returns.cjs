const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

console.log("strict:", (function () { return this === undefined; })());

function Plain(length) {
  log.push("Plain " + length);
  return { length: "unset", push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } };
}
const species = [
  ["Array", () => Array],
  ["a subclass", () => Odd],
  ["a function that returns an object", () => Plain],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 5],
  ["an arrow function", () => () => []],
  ["a proxy of Array", () => new Proxy(Array, { construct(target, list) { log.push("construct " + list.join()); return logged(Reflect.construct(target, list)); } })],
];

let chosen = species[0][1];
class Special extends Array {
  static get [Symbol.species]() {
    return chosen();
  }
}
const special = () => Special.of(5, 6);
const marked = () => {
  const list = [5, 6];
  list.constructor = { [Symbol.species]: chosen() };
  return list;
};

function mapsThenPushes(list) {
  const a = list.map(x => x * 2);
  a.push(1);
  return a.length;
}
function filtersThenIterates(list) {
  const a = list.filter(() => true);
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
function slicesThenPushes(list) {
  const a = list.slice(0);
  a.push(1);
  return a.length;
}
function concatenatesThenIterates(list) {
  const a = list.concat([7]);
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
function splicesThenPushes(list) {
  const a = list.splice(0, 1);
  a.push(1);
  return [a.length, list.length];
}
function flattensThenIterates(list) {
  const a = list.flatMap(x => [x, x]);
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

const table = [
  ["mapsThenPushes", mapsThenPushes],
  ["filtersThenIterates", filtersThenIterates],
  ["slicesThenPushes", slicesThenPushes],
  ["concatenatesThenIterates", concatenatesThenIterates],
  ["splicesThenPushes", splicesThenPushes],
  ["flattensThenIterates", flattensThenIterates],
];

for (let i = 0; i < 2000; i++) {
  mapsThenPushes([5, 6]);
  filtersThenIterates([5, 6]);
  slicesThenPushes([5, 6]);
  concatenatesThenIterates([5, 6]);
  splicesThenPushes([5, 6]);
  flattensThenIterates([5, 6]);
}
for (const [name, use] of table) {
  for (const [label, choose] of [...species, species[0]]) {
    chosen = choose;
    attempt(name + " of a subclass whose species is " + label, () => use(special()));
    attempt(name + " of an array whose own constructor has the species " + label, () => use(marked()));
    attempt(name + " of an array", () => use([5, 6]));
  }
}
