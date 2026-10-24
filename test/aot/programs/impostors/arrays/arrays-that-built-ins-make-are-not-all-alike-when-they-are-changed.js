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

function template(strings) {
  return strings;
}

function rest(...values) {
  return values;
}

const makers = {
  "a literal": () => ["a", "b", "c"],
  "split": () => "a-b-c".split("-"),
  "split into characters": () => "abc".split(""),
  "match": () => "abc".match(/(a)(x)?(c)?/),
  "match with names": () => "abc".match(/(?<first>a)(?<second>b)/),
  "match with indices": () => "abc".match(/(a)b/d).indices,
  "a global match": () => "abc".match(/./g),
  "exec": () => /b/.exec("abc"),
  "matchAll": () => [..."abc".matchAll(/b/g)][0],
  "a template's strings": () => template`a${1}b${2}c`,
  "a template's raw strings": () => template`a${1}b${2}c`.raw,
  "Object.keys": () => Object.keys({ a: 1, b: 2, c: 3 }),
  "an entry of Object.entries": () => Object.entries({ a: "b" })[0],
  "an entry of a Map": () => [...new Map([["a", "b"]])][0],
  "an entry of entries()": () => ["a"].entries().next().value,
  "Reflect.ownKeys": () => Reflect.ownKeys({ a: 1, b: 2 }),
  "Array.from": () => Array.from("abc"),
  "Array.of": () => Array.of("a", "b", "c"),
  "new Array(3)": () => new Array(3),
  "Array(3).fill": () => Array(3).fill("a"),
  "Array.apply": () => Array.apply(null, Array(3)),
  "new Array of three": () => new Array("a", "b", "c"),
  "concat": () => [].concat("a", ["b"], [["c"]]),
  "slice": () => ["z", "a", "b", "c"].slice(1),
  "splice": () => ["a", "b", "c"].splice(0, 3),
  "map": () => [1, 2, 3].map(value => "abc"[value - 1]),
  "filter": () => ["a", "", "b", "c"].filter(Boolean),
  "flat": () => [["a"], ["b", ["c"]]].flat(),
  "toSorted": () => ["c", "a", "b"].toSorted(),
  "a rest parameter": () => rest("a", "b", "c"),
  "a rest element": () => { const [, ...tail] = "zabc"; return tail; },
  "a spread": () => [..."abc"],
  "structuredClone": () => structuredClone(["a", , "c"]),
  "structuredClone of an array with a name": () => structuredClone(Object.assign(["a"], { name: "kept" })),
  "JSON.parse": () => JSON.parse('["a","b","c"]'),
  "a group of Object.groupBy": () => Object.groupBy(["a", "b", "c"], () => "all").all,
  "a group of Map.groupBy": () => Map.groupBy(["a", "b", "c"], () => "all").get("all"),
  "an iterator's toArray": () => ["a", "b", "c"].values().toArray(),
  "formatToParts": () => new Intl.NumberFormat("en").formatToParts(1).map(part => part.type),
  "a Buffer": () => Buffer.from("abc"),
};

const uses = {
  push: list => [list.push("pushed"), list.length],
  append(list) {
    list[list.length] = "appended";
    return list.length;
  },
  storeFirst(list) {
    list[0] = 1.5;
    return list[0];
  },
  pop: list => [list.pop(), list.length],
  truncate(list) {
    list.length = 1;
    return list;
  },
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use](["a", "b", "c"]);

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](makers[name]()));
