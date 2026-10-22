import { format, inspect, isDeepStrictEqual } from "node:util";

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
  ["inspect", entry => inspect(entry)],
  ["Bun.inspect", entry => Bun.inspect(entry).replace(/\s+/g, " ")],
  ["format with %j", entry => format("%j", entry)],
  ["format with %o", entry => format("%o", entry).replace(/\s+/g, " ")],
  ["inspect of a structured clone", entry => inspect(structuredClone(entry))],
  ["inspect of a list that holds it", entry => inspect([entry])],
  ["inspect of a Map that holds it", entry => inspect(new Map([["key", entry]]))],
  ["deep equality with another one of the same history", (entry, again) => isDeepStrictEqual(entry, again)],
  ["Bun.deepEquals with another one of the same history", (entry, again) => Bun.deepEquals(entry, again, true)],
];

let sum = 0;
for (let i = 0; i < 2000; i++) for (const [, make] of kinds) sum += make("alpha first").alpha + make("gamma first").beta + make("short").alpha;
console.log("2000 honest rounds", sum);

for (const [kind, make] of kinds) {
  for (const [history, build] of histories) {
    for (const [name, list] of listers) {
      let line = kind + " | " + history + " | " + name + " -> ";
      try {
        line += String(list(build(make), build(make)));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}

for (const [kind, make] of kinds) {
  for (const [history, build] of histories) {
    if (history !== "gamma first" && history !== "alpha deleted and stored again" && history !== "one more member in front of gamma") continue;
    console.log(kind + " | " + history + " | console.log ->", build(make));
  }
}
