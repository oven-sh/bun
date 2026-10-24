function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const uses = {
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
