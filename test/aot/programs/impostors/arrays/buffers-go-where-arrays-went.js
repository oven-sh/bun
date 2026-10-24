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
  checks: list => [Array.isArray(list), Buffer.isBuffer(list), list instanceof Uint8Array, list.constructor.name, list.length],
  sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  walk(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  copy: list => [...list],
  sliceThenStore(list) {
    const part = list.slice(1, 3);
    part[0] = 33;
    return [list[1], part[0], part.length, part.constructor.name];
  },
  subarrayThenStore(list) {
    const part = list.subarray(1, 3);
    part[0] = 33;
    return [list[1], part[0]];
  },
  storeTooMuch(list) {
    list[0] = 300;
    list[1] = -1;
    list[2] = 1.9;
    return [list[0], list[1], list[2]];
  },
  append(list) {
    list[list.length] = 1;
    return list.length;
  },
  push: list => list.push(1),
  concat: list => list.concat([1]),
  givenToConcat: list => [0].concat(list).length,
  indexOfANumber: list => [list.indexOf(98), list.indexOf(354), list.lastIndexOf(98), list.includes(98)],
  indexOfText: list => [list.indexOf("b"), list.indexOf("bc"), list.includes("cb"), list.lastIndexOf("b")],
  fillWithText: list => Array.from(list.fill("xy")),
  fillWithANumber: list => Array.from(list.fill(300)),
  text: list => [String(list), list.toString(), `${list}`, list + ""],
  join: list => list.join("-"),
  map(list) {
    const result = list.map(value => value + 200);
    return [result.constructor.name, Array.from(result)];
  },
  filter(list) {
    const result = list.filter(value => value > 97);
    return [result.constructor.name, result.length];
  },
  sort: list => Array.from(list.sort((a, b) => b - a)),
  sortByDefault: list => Array.from(list.sort()),
  reverse: list => Array.from(list.reverse()),
  toReversed: list => list.toReversed().constructor.name,
  at: list => [list.at(0), list.at(-1), list.at(9)],
  json: list => JSON.stringify(list),
  keys: list => Object.keys(list).join(),
  entries: list => [...list.entries()].length,
  pattern(list) {
    const [first, , third = "default", ...rest] = list;
    return [first, third, rest];
  },
  largest: list => Math.max(...list),
  applied: list => String.fromCharCode.apply(null, list),
  from: list => Array.from(list, value => value * 2),
  truncate(list) {
    try {
      list.length = 1;
    } catch (error) {
      return error.constructor.name;
    }
    return list.length;
  },
  reduce: list => list.reduce((text, value) => text + String.fromCharCode(value), ""),
  equal: list => [list == "abcb", list === list, list.equals ? list.equals(Buffer.from("abcb")) : "no equals"],
};

const makers = {
  "an array": () => [97, 98, 99, 98],
  "a buffer from text": () => Buffer.from("abcb"),
  "a buffer from an array": () => Buffer.from([97, 98, 99, 98]),
  "a buffer that was allocated": () => { const buffer = Buffer.alloc(4); buffer.write("abcb"); return buffer; },
  "a slice of a larger buffer": () => Buffer.from("xabcbx").subarray(1, 5),
  "a buffer over an array buffer": () => Buffer.from(new Uint8Array([97, 98, 99, 98]).buffer),
  "a concatenated buffer": () => Buffer.concat([Buffer.from("ab"), Buffer.from("cb")]),
  "a Uint8Array": () => new Uint8Array([97, 98, 99, 98]),
  "an empty buffer": () => Buffer.alloc(0),
};

for (const use in uses) {
  for (let i = 0; i < 1000; i++) {
    try {
      uses[use]([97, 98, 99, 98]);
    } catch {}
  }
}

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](makers[name]()));
