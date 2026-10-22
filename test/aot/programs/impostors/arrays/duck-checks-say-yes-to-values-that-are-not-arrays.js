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

const makers = {
  "an object tagged Array": () => ({ [Symbol.toStringTag]: "Array", 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array tagged otherwise": () => Object.assign([3, 1, 2], { [Symbol.toStringTag]: "Other" }),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "an object with a push and a length": () => ({ length: 3, 0: 3, 1: 1, 2: 2, push(value) { return "pushed " + value; } }),
  "an object with a length that is text": () => ({ length: "3", 0: 3, 1: 1, 2: 2 }),
  "an object with a fractional length": () => ({ length: 2.5, 0: 3, 1: 1, 2: 2 }),
  "an object with a negative length": () => ({ length: -3, 0: 3 }),
  "an object with a length of NaN": () => ({ length: NaN, 0: 3 }),
  "a function": () => function (a, b, c) {},
  "a string": () => "312",
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "an iterable without a length": () => ({ *[Symbol.iterator]() { yield 3; yield 1; yield 2; } }),
  "an iterable whose length disagrees": () => ({ length: 1, 0: "by index", *[Symbol.iterator]() { yield "by"; yield "iterator"; } }),
  "a Set": () => new Set([3, 1, 2]),
  "an array": () => [3, 1, 2],
};

function byTag(value) {
  if (Object.prototype.toString.call(value) !== "[object Array]") return "another tag";
  let total = 0;
  for (let i = 0; i < value.length; i++) total += value[i];
  return total;
}

function byNumericLength(value) {
  if (typeof value.length !== "number") return "no numeric length";
  const seen = [];
  for (let i = 0; i < value.length; i++) seen.push(value[i]);
  return seen;
}

function byPush(value) {
  if (!value || typeof value.push !== "function") return "no push";
  return [value.push(9), value.length];
}

function byIterator(value) {
  if (typeof value[Symbol.iterator] !== "function") return "not iterable";
  const seen = [];
  for (const element of value) seen.push(element);
  return seen;
}

function byLengthInObject(value) {
  if (typeof value !== "object" || !("length" in value)) return "no length";
  return value.length > 0 ? value[value.length - 1] : "empty";
}

function byTruthyLength(value) {
  return value.length ? value[0] : "nothing in it";
}

function byIteratorThenIndex(value) {
  if (!(Symbol.iterator in Object(value))) return "not iterable";
  return [value.length, value[0], [...value].length];
}

const uses = { byTag, byNumericLength, byPush, byIterator, byLengthInObject, byTruthyLength, byIteratorThenIndex };

function round(title) {
  for (const name in makers) for (const use in uses) attempt(title + ", " + use + ", " + name, () => uses[use](makers[name]()));
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
round("after 2000 arrays");
