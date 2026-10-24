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
  names(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(list[i].name);
    return out;
  },
  namesByIteration(list) {
    const out = [];
    for (const item of list) out.push(item.name);
    return out;
  },
  namesByMap: list => list.map(item => item.name),
  namesByPattern(list) {
    const out = [];
    for (const { name } of list) out.push(name);
    return out;
  },
  optionalNames: list => list.map(item => item?.name),
  lengths(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i].name.length;
    return total;
  },
  upper: list => list.map(item => item.name.toUpperCase()),
  renamed(list) {
    for (const item of list) item.name = "renamed";
    return list.map(item => (item === null || item === undefined ? item : item.name));
  },
  sortedByName: list => list.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(item => typeof item),
  found: list => typeof list.find(item => item.name === "zed"),
  counted: list => list.filter(item => "name" in item).length,
  called: list => list.map(item => item.greet()),
  keyed: list => Object.fromEntries(list.map(item => [item.name, true])),
};

function item(name) {
  return { name, greet() { return "hello " + this.name; } };
}

class Named {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return "hi " + this.name;
  }
}

const log = [];

const odd = {
  "an item": () => item("zed"),
  "an item with its members in another order": () => ({ greet() { return "other order"; }, name: "zed" }),
  "an item with more members": () => ({ id: 1, name: "zed", extra: true, greet: () => "more" }),
  "an instance of a class": () => new Named("zed"),
  "an item whose name is a getter": () => ({ get name() { log.push("get"); return "zed"; }, set name(value) { log.push("set"); }, greet: () => "getter" }),
  "an item whose name is inherited": () => Object.create(item("zed")),
  "an item whose name is a number": () => ({ name: 5, greet: () => "number" }),
  "an item without a name": () => ({ greet: () => "nameless" }),
  "an item whose greet is no function": () => ({ name: "zed", greet: "hello" }),
  "a frozen item": () => Object.freeze(item("zed")),
  "a function": () => function zed() {},
  "a class": () => class zed { static greet() { return "static"; } },
  "a string": () => "zed",
  "a number": () => 5,
  "a symbol": () => Symbol("zed"),
  "an array": () => ["zed"],
  "an error": () => new RangeError("zed"),
  "a proxy": () => new Proxy(item("zed"), {}),
  "an item under null": () => Object.assign(Object.create(null), item("zed")),
  "null": () => null,
  "undefined": () => undefined,
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([item("amy"), item("bob"), item("cat")]);

for (const name in odd) {
  for (const use in uses) {
    log.length = 0;
    let answer;
    try {
      answer = describe(uses[use]([item("amy"), odd[name](), item("cat")]));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log("the second is " + name + ", " + use + ": " + answer + (log.length ? " after " + log.join(" ") : ""));
  }
}
for (const use in uses) attempt("the second is missing, " + use, () => uses[use]([item("amy"), , item("cat")]));
