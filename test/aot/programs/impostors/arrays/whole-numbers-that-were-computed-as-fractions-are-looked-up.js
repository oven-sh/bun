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

const computations = {
  half: value => value / 2,
  sum: value => value / 4 + value / 4,
  root: value => Math.sqrt(value * value) / 2,
  floor: value => Math.floor(value / 2 + 0.25),
  round: value => Math.round(value / 2 - 0.25),
  fromAFloatArray: value => new Float64Array([value / 2])[0],
  parsed: value => parseFloat(String(value / 2) + ".0"),
  power: value => (value / 2) ** 1,
  product: value => value * 0.5,
  minimum: value => Math.min(value / 2, 1e9),
  remainder: value => (value / 2) % 1e9,
  negatedTwice: value => -(-value / 2),
};

const lookups = {
  indexOf: (list, number) => list.indexOf(number),
  lastIndexOf: (list, number) => list.lastIndexOf(number),
  includes: (list, number) => list.includes(number),
  element: (list, number) => list[number],
  at: (list, number) => list.at(number),
  has: (list, number) => number in list,
  own: (list, number) => Object.hasOwn(list, number),
  store(list, number) {
    list[number] = "stored";
    return Object.keys(list).join();
  },
  remove(list, number) {
    delete list[number];
    return Object.keys(list).join();
  },
  slice: (list, number) => list.slice(number),
  withCopy: (list, number) => list.with(number, "with"),
  splice: (list, number) => list.splice(number, 1),
  fill: (list, number) => list.fill("filled", number),
  truncate(list, number) {
    list.length = number;
    return list;
  },
  sized: (list, number) => new Array(number).length,
  from: (list, number) => Array.from({ length: number }, (_, index) => index),
  inASet: (list, number) => new Set(list).has(number),
  inAMap: (list, number) => new Map(list.map(value => [value, "found " + value])).get(number),
  asASetMember: (list, number) => new Set([number, 2, 0]).size,
  asAKey: (list, number) => ({ 0: "zero", 2: "two" })[number],
  character: (list, number) => "abcd"[number] + "abcd".charAt(number),
  typedElement: (list, number) => new Uint8Array([9, 8, 7, 6])[number],
  findIndex: (list, number) => list.findIndex(value => value === number),
  switched(list, number) {
    switch (number) {
      case 0:
        return "zero";
      case 2:
        return "two";
      default:
        return "neither";
    }
  },
  same: (list, number) => [number === list[1], Object.is(number, list[1]), number == list[1]],
  text: (list, number) => String(number) + "|" + JSON.stringify([number]) + "|" + `${number}`,
};

for (const lookup in lookups) for (let i = 0; i < 1000; i++) lookups[lookup]([1, 2, 3, 0], i & 3);

for (const lookup in lookups) {
  for (const input of [4, 0, -0]) {
    const answers = [];
    for (const computation in computations) {
      let answer;
      try {
        answer = describe(lookups[lookup]([1, 2, 3, 0], computations[computation](input)));
      } catch (error) {
        answer = error.constructor.name;
      }
      if (!answers.includes(answer)) answers.push(answer);
    }
    console.log(lookup + ", from " + describe(input) + ": " + answers.join(" | "));
  }
}

function inOneFunction(list, value) {
  const number = value / 2;
  return [list.indexOf(number), list.includes(number), list[number], list.lastIndexOf(number), number in list, new Set(list).has(number)];
}

function withANegativeZero(list, value) {
  const number = value * -1;
  return [list.indexOf(number), list.includes(number), list[number], list.lastIndexOf(number), number in list, new Set(list).has(number), Object.is(number, -0)];
}

function countingByHalves(list) {
  const seen = [];
  for (let i = 0; i < list.length; i += 0.5) seen.push(list[i]);
  return seen;
}

function countingDownByDivision(list) {
  const seen = [];
  for (let i = 8; i >= 1; i /= 2) seen.push(list[i]);
  return seen;
}

for (let i = 0; i < 1000; i++) {
  inOneFunction([1, 2, 3, 0], 2);
  withANegativeZero([1, 2, 3, 0], 1);
}
attempt("in one function, 4", () => inOneFunction([1, 2, 3, 0], 4));
attempt("in one function, 3", () => inOneFunction([1, 2, 3, 0], 3));
attempt("in one function, 0", () => inOneFunction([1, 2, 3, 0], 0));
attempt("in one function, doubles", () => inOneFunction([1.5, 2, 3.5, 0], 4));
attempt("a negative zero", () => withANegativeZero([1, 2, 3, 0], 0));
attempt("a negative zero among doubles", () => withANegativeZero([1.5, 2, 3.5, 0], 0));
attempt("a negative zero among strings", () => withANegativeZero(["a", 0], 0));
attempt("counting by halves", () => countingByHalves([1, 2, 3]));
attempt("counting down by division", () => countingDownByDivision([0, 1, 2, 3, 4, 5, 6, 7, 8]));
