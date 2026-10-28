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
  sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  integerSum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total = (total + list[i]) | 0;
    return total;
  },
  product(list) {
    let total = 1;
    for (let i = 0; i < list.length; i++) total *= list[i];
    return total;
  },
  successors(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(list[i] + 1);
    return out;
  },
  sumOfIteration(list) {
    let total = 0;
    for (const value of list) total += value;
    return total;
  },
};

const lasts = {
  "an integer": 3,
  "a double": 3.5,
  "a negative zero": -0,
  "zero": 0,
  "NaN": NaN,
  "infinity": Infinity,
  "2 ** 31": 2 ** 31,
  "2 ** 31 - 1": 2 ** 31 - 1,
  "-(2 ** 31)": -(2 ** 31),
  "2 ** 53": 2 ** 53,
  "a string of digits": "3",
  "a word": "three",
  "an empty string": "",
  "undefined": undefined,
  "null": null,
  "true": true,
  "a big integer": 3n,
  "an object with valueOf": { valueOf: () => 3 },
  "an object with toString": { toString: () => "3" },
  "an array of one": [3],
  "a symbol": Symbol("three"),
  "a date": new Date(3),
};

const starts = { integers: [1, 2], doubles: [1.5, 2.5] };

for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([1, 2, 3]);

for (const start in starts) {
  for (const name in lasts) {
    for (const use in uses) {
      attempt(start + " and then " + name + ", " + use, () => {
        const result = uses[use]([...starts[start], lasts[name]]);
        return typeof result === "object" ? result.map(value => (typeof value === "object" && value !== null ? "an object" : typeof value === "symbol" ? "a symbol" : value)) : result;
      });
    }
  }
}

for (const use in uses) attempt("integers and then a hole and an integer, " + use, () => uses[use]([1, 2, , 3]));
for (const use in uses) attempt("doubles and then a hole and a double, " + use, () => uses[use]([1.5, 2.5, , 3.5]));
