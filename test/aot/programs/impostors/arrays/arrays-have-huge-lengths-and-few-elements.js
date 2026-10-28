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

const most = 2 ** 32 - 1;

function full() {
  const list = [];
  list.length = most;
  return list;
}

function fullWithALastElement() {
  const list = ["first"];
  list[most - 1] = "last";
  return list;
}

function lengthOf(list) {
  return list.length;
}

function last(list) {
  return list[list.length - 1];
}

function pushOne(list) {
  return list.push("pushed");
}

function append(list) {
  list[list.length] = "appended";
  return list.length;
}

function popOne(list) {
  return list.pop();
}

function firstThree(list) {
  const seen = [];
  for (let i = 0; i < list.length; i++) {
    seen.push(list[i]);
    if (seen.length === 3) break;
  }
  return seen;
}

function firstThreeByIteration(list) {
  const seen = [];
  for (const value of list) {
    seen.push(value);
    if (seen.length === 3) break;
  }
  return seen;
}

function collectUntilThree(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i === 3) return out;
    out.push(list[i]);
  }
  return out;
}

function acrossTheLimitOfSmallIntegers(list) {
  const seen = [];
  for (let i = 2147483645; i < list.length; i++) {
    seen.push(i, list[i]);
    if (seen.length === 12) break;
  }
  return seen;
}

function downFromTheEnd(list) {
  const seen = [];
  for (let i = list.length - 1; i >= 0; i--) {
    seen.push(i);
    if (seen.length === 3) break;
  }
  return seen;
}

function lastTwo(list) {
  return list.slice(-2);
}

function ends(list) {
  return [list.at(0), list.at(-1)];
}

function firstTwo(list) {
  const [a, b] = list;
  return [a, b];
}

function store(list, index) {
  list[index] = "stored";
  return [list.length, Object.keys(list)];
}

function setLength(list, length) {
  list.length = length;
  return list.length;
}

const uses = { lengthOf, last, pushOne, append, popOne, firstThree, firstThreeByIteration, collectUntilThree, acrossTheLimitOfSmallIntegers, downFromTheEnd, lastTwo, ends, firstTwo };

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, 2, 3, 4]);
for (let i = 0; i < 1000; i++) {
  store([1], 1);
  setLength([1, 2], 1);
}

const makers = {
  "a full length and nothing in it": full,
  "a full length with a first and a last element": fullWithALastElement,
  "a length of a million and nothing in it": () => new Array(1000000),
  "a length of 2 ** 31": () => { const list = [1]; list.length = 2 ** 31; return list; },
  "an array-like with a length of 2 ** 53 - 1": () => ({ __proto__: Array.prototype, length: 2 ** 53 - 1, 0: "first" }),
  "an array-like with a length of 2 ** 32": () => ({ __proto__: Array.prototype, length: 2 ** 32, 0: "first", [2 ** 32 - 1]: "last" }),
  "an array-like with an infinite length": () => ({ __proto__: Array.prototype, length: Infinity, 0: "first" }),
};

for (const name in makers) {
  for (const use in uses) {
    const list = makers[name]();
    attempt(name + ", " + use, () => uses[use](list));
    console.log("  left " + describe(list));
  }
}

const indexes = [most - 1, most, most + 1, 2 ** 31, 2 ** 31 - 1, -1, 1.5, 1e21, "4294967294", "4294967295", "1e3", "01", "-0", -0, NaN, Infinity];
for (const index of indexes) attempt("a store at " + describe(index), () => store([1], index));

const lengths = [most, most + 1, -1, 1.5, NaN, "3", "x", null, undefined, true, -0, [2], { valueOf: () => 2 }, 2n];
for (const length of lengths) attempt("a length of " + describe(length), () => setLength([1, 2, 3, 4], length));
for (const length of lengths) attempt("new Array(" + describe(length) + ")", () => new Array(length));
