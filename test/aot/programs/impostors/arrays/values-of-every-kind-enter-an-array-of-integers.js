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

const values = {
  "an integer": 7,
  "a double": 7.5,
  "a negative zero": -0,
  "NaN": NaN,
  "infinity": -Infinity,
  "2 ** 31": 2 ** 31,
  "-(2 ** 31) - 1": -(2 ** 31) - 1,
  "2 ** 53": 2 ** 53,
  "a tiny double": 5e-324,
  "a string": "seven",
  "undefined": undefined,
  "null": null,
  "true": true,
  "a big integer": 7n,
  "an object": { seven: 7 },
  "an array": [7],
};

const ways = {
  push(list, value) {
    list.push(value);
  },
  pushWithOthers(list, value) {
    list.push(4, value, 5);
  },
  append(list, value) {
    list[list.length] = value;
  },
  storeFirst(list, value) {
    list[0] = value;
  },
  storeLast(list, value) {
    list[list.length - 1] = value;
  },
  storePastAHole(list, value) {
    list[list.length + 1] = value;
  },
  unshift(list, value) {
    list.unshift(value);
  },
  splice(list, value) {
    list.splice(1, 0, value);
  },
  fill(list, value) {
    list.fill(value, 1, 2);
  },
  inALoop(list, value) {
    for (let i = 0; i < 3; i++) list[i] = i === 1 ? value : i;
  },
  byPattern(list, value) {
    [list[1]] = [value];
  },
  bySwap(list, value) {
    list.push(value);
    [list[0], list[3]] = [list[3], list[0]];
  },
};

const makers = {
  literal: value => [1, value, 3],
  spread: value => [...[1, 2], value],
  of: value => Array.of(1, value),
  concat: value => [1, 2].concat([value]),
  concatOfAValue: value => [1, 2].concat(value),
  map: value => [1, 2, 3].map((element, index) => (index === 1 ? value : element)),
  from: value => Array.from({ length: 3 }, (_, index) => (index === 1 ? value : index)),
  filled: value => new Array(3).fill(value),
  withCopy: value => [1, 2, 3].with(1, value),
  collected(value) {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(i === 1 ? value : i);
    return out;
  },
  sized(value) {
    const out = new Array(3);
    for (let i = 0; i < 3; i++) out[i] = i === 1 ? value : i;
    return out;
  },
};

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function summary(list) {
  let total;
  try {
    total = describe(sum(list));
  } catch (error) {
    total = "threw " + error.constructor.name;
  }
  return describe(list) + ", sum " + total;
}

for (let i = 0; i < 1000; i++) {
  for (const way in ways) ways[way]([1, 2, 3], i);
  for (const maker in makers) sum(makers[maker](i));
}

for (const name in values) {
  for (const way in ways) {
    const list = [1, 2, 3];
    ways[way](list, values[name]);
    console.log(name + ", " + way + ": " + summary(list));
  }
  for (const maker in makers) console.log(name + ", " + maker + ": " + summary(makers[maker](values[name])));
}
