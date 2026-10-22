import { inspect, isDeepStrictEqual } from "node:util";

class Entry {
  constructor(order) {
    if (order === "alpha first") {
      this.alpha = 1;
      this.beta = 2;
      this.gamma = 3;
    } else if (order === "gamma first") {
      this.gamma = 3;
      this.beta = 2;
      this.alpha = 1;
    } else {
      this.beta = 2;
      this.alpha = 1;
    }
  }
  sum() {
    return this.alpha + this.beta;
  }
}

function OldEntry(order) {
  if (order === "alpha first") {
    this.alpha = 1;
    this.beta = 2;
    this.gamma = 3;
  } else if (order === "gamma first") {
    this.gamma = 3;
    this.beta = 2;
    this.alpha = 1;
  } else {
    this.beta = 2;
    this.alpha = 1;
  }
}
OldEntry.prototype.sum = function () {
  return this.alpha + this.beta;
};

function fill(order) {
  const entry = {};
  if (order === "alpha first") {
    entry.alpha = 1;
    entry.beta = 2;
    entry.gamma = 3;
  } else if (order === "gamma first") {
    entry.gamma = 3;
    entry.beta = 2;
    entry.alpha = 1;
  } else {
    entry.beta = 2;
    entry.alpha = 1;
  }
  return entry;
}

const kinds = [
  ["class", order => new Entry(order)],
  ["constructor function", order => new OldEntry(order)],
  ["a literal that is filled", fill],
];

const histories = [
  ["alpha first", make => make("alpha first")],
  ["gamma first", make => make("gamma first")],
  ["beta, alpha", make => make("short")],
  ["beta, alpha, then gamma", make => { const entry = make("short"); entry.gamma = 3; return entry; }],
  ["alpha deleted and stored again", make => { const entry = make("alpha first"); delete entry.alpha; entry.alpha = 1; return entry; }],
  ["all deleted, stored backwards", make => { const entry = make("alpha first"); delete entry.alpha; delete entry.beta; delete entry.gamma; entry.gamma = 3; entry.beta = 2; entry.alpha = 1; return entry; }],
  ["one more member in front of gamma", make => { const entry = make("short"); entry.delta = 4; entry.gamma = 3; return entry; }],
  ["an index member stored last", make => { const entry = make("alpha first"); entry[0] = "zero"; return entry; }],
  ["beta hidden from enumeration", make => Object.defineProperty(make("alpha first"), "beta", { enumerable: false })],
];

const listers = [
  ["keys", new Function("entry", "return Object.keys(entry).join();")],
  ["for-in", new Function("entry", "var names = []; for (var name in entry) names.push(name); return names.join();")],
  ["entries", new Function("entry", "return Object.entries(entry).join(';');")],
  ["ownKeys", new Function("entry", "return Reflect.ownKeys(entry).join();")],
  ["json", new Function("entry", "return JSON.stringify(entry);")],
  ["spread", new Function("entry", "return Object.keys({ ...entry }).join();")],
  ["rest", new Function("entry", "var { beta, ...rest } = entry; return Object.keys(rest).join();")],
  ["clone", new Function("entry", "return Object.keys(structuredClone(entry)).join();")],
  ["inspect", entry => inspect(entry)],
  ["deep equality with a copy made by hidden code", entry => isDeepStrictEqual(entry, new Function("entry", "return Object.assign(Object.create(Object.getPrototypeOf(entry)), entry);")(entry))],
];

let sum = 0;
for (let i = 0; i < 2000; i++) for (const [, make] of kinds) sum += make("alpha first").alpha + make("gamma first").beta + make("short").alpha;
console.log("2000 honest rounds", sum);

for (const [kind, make] of kinds) {
  for (const [history, build] of histories) {
    for (const [name, list] of listers) {
      let line = kind + " | " + history + " | " + name + " -> ";
      try {
        line += String(list(build(make)));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}
