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

const log = [];

function read(list, key) {
  return list[key];
}

function store(list, key) {
  list[key] = "stored";
  return [list.length, Object.keys(list).join()];
}

function has(list, key) {
  return key in list;
}

function remove(list, key) {
  return [delete list[key], Object.keys(list).join()];
}

function add(list, key) {
  list[key] += 1;
  return [list[key], list.length];
}

function readNext(list, key) {
  return list[key + 1];
}

function readTruncated(list, key) {
  return list[key | 0];
}

function at(list, key) {
  return list.at(key);
}

function walkFrom(list, key) {
  const seen = [];
  for (let i = key; i < list.length; i++) {
    seen.push(list[i]);
    if (seen.length === 4) break;
  }
  return seen;
}

function own(list, key) {
  return Object.hasOwn(list, key);
}

const uses = { read, store, has, remove, add, readNext, readTruncated, at, walkFrom, own };

const keys = {
  "1": 1,
  "0": 0,
  "-0": -0,
  "-1": -1,
  "3 (the length)": 3,
  "1.5": 1.5,
  "1.0000000000000002": 1.0000000000000002,
  "NaN": NaN,
  "Infinity": Infinity,
  "2 ** 31": 2 ** 31,
  "2 ** 32 - 2": 2 ** 32 - 2,
  "2 ** 32 - 1": 2 ** 32 - 1,
  "2 ** 32 + 1": 2 ** 32 + 1,
  "1e21": 1e21,
  "the text 1": "1",
  "the text 01": "01",
  "the text 1.0": "1.0",
  "the text -0": "-0",
  "the text 1e0": "1e0",
  "the text of a space and 1": " 1",
  "the empty text": "",
  "the text length": "length",
  "the text push": "push",
  "the big integer 1": 1n,
  "true": true,
  "null": null,
  "undefined": undefined,
  "an array of 1": [1],
  "an object that turns into 1": { toString() { log.push("toString"); return "1"; } },
  "an object with a primitive of 1": { [Symbol.toPrimitive](hint) { log.push(hint); return 1; } },
  "a Number object": new Number(1),
  "the iterator symbol": Symbol.iterator,
  "a new symbol": Symbol("new"),
};

for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([10, 20, 30], i % 3);

for (const name in keys) {
  for (const use in uses) {
    log.length = 0;
    attempt(name + ", " + use, () => {
      const answer = uses[use]([10, 20, 30], keys[name]);
      return typeof answer === "function" ? "a function" : answer;
    });
    if (log.length) console.log("  log: " + log.join(", "));
  }
}
