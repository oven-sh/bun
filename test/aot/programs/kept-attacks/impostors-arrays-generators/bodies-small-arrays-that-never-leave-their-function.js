// Impostors arrays generators: bodies small arrays that never leave their function. It prints what plain Bun prints.
const uses = {
  //group and-are-read-or-taken-apart
  includes: (a, b) => [a, 1].includes(b),
  indexOf: (a, b) => [a, 1].indexOf(b),
  lastIndexOf: (a, b) => [a, 1, a].lastIndexOf(b),
  sum(a, b) {
    const pair = [a, b];
    return pair[0] + pair[1];
  },
  swap(a, b) {
    [a, b] = [b, a];
    return [a, b];
  },
  rotate(a, b) {
    let c = "c";
    [a, b, c] = [b, c, a];
    return [a, b, c];
  },
  tooFew(a, b) {
    const [x, y, z = "default"] = [a, b];
    return [x, y, z];
  },
  defaults(a, b) {
    const [x = "default x", y = "default y"] = [a, b];
    return [x, y];
  },
  largest: (a, b) => Math.max(...[a, b]),
  largestOfTwoSpreads: (a, b) => Math.max(...[a], ...[b]),
  lengthOf: (a, b) => [a, b, ,].length,
  outside(a, b) {
    const pair = [a, b];
    return [pair[2], pair[-1], pair["0"], pair.length, pair["length"]];
  },
  byAKey(a, b) {
    const pair = ["zero", "one"];
    return [pair[a], pair[b]];
  },
  identity(a, b) {
    const pair = [a, b];
    const same = pair;
    return [pair === same, pair === [a, b], pair == String(pair)];
  },
  named(a, b) {
    const pair = [a, b];
    pair.name = "pair";
    return [Object.keys(pair).join(), pair.name];
  },
  frozen(a, b) {
    const pair = Object.freeze([a, b]);
    try {
      pair[0] = "stored";
    } catch (error) {
      return [error.constructor.name, typeof pair[0]];
    }
    return ["no error", typeof pair[0]];
  },
  //group and-are-walked-or-converted
  joined: (a, b) => [a, b].join("-"),
  text: (a, b) => String([a, b]),
  walked(a, b) {
    let text = "";
    for (const value of [a, b]) text += typeof value + " ";
    return text;
  },
  mapped: (a, b) => [a, b].map(value => typeof value),
  filtered: (a, b) => [a, b].filter(Boolean).length,
  sorted: (a, b) => [a, b, 10, 9].sort().map(String),
  sortedByNumber: (a, b) => [a, b, 10, 9].sort((x, y) => x - y).map(String),
  some: (a, b) => [a, b].some(value => value === undefined),
  every: (a, b) => [a, b].every(value => value == null),
  reduced: (a, b) => [a, b].reduce((total, value) => total + value),
  flat: (a, b) => [a, [b]].flat().length,
  concat: (a, b) => [].concat(a, b).length,
  json: (a, b) => JSON.stringify([a === undefined || typeof a === "bigint" || typeof a === "symbol" ? "skipped" : a, typeof b]),
  set: (a, b) => new Set([a, b, a]).size,
  entries: (a, b) => Object.fromEntries([["a", typeof a], ["b", typeof b]]),
};

const values = {
  "1": 1,
  "0": 0,
  "-0": -0,
  NaN: NaN,
  "1.5": 1.5,
  "the text 1": "1",
  "an empty text": "",
  undefined: undefined,
  null: null,
  true: true,
  "1n": 1n,
  "an object": { valueOf: () => 1 },
  "an array": [1],
  "a symbol": Symbol("one"),
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use](i & 1, 1);

for (const use in uses) {
  const answers = [];
  for (const name in values) {
    for (const [a, b] of [[values[name], 1], [1, values[name]], [values[name], values[name]]]) {
      try {
        answers.push(describe(uses[use](a, b)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
    }
    console.log(use + ", " + name + " first, second, both: " + answers.splice(0).join(" | "));
  }
}
