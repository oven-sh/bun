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

function withAGetter() {
  return Object.defineProperty([3, 1, 2], 1, {
    get() {
      log.push("get 1");
      return 10;
    },
    enumerable: true,
    configurable: true,
  });
}

function withAGetterAndASetter() {
  let held = 10;
  return Object.defineProperty([3, 1, 2], 1, {
    get() {
      log.push("get 1");
      return held;
    },
    set(value) {
      log.push("set 1 to " + describe(value));
      held = value;
    },
    enumerable: true,
    configurable: true,
  });
}

function withOnlyASetter() {
  return Object.defineProperty([3, 1, 2], 1, {
    set(value) {
      log.push("set 1 to " + describe(value));
    },
    enumerable: true,
    configurable: true,
  });
}

const catching = {
  __proto__: Array.prototype,
  get 3() {
    log.push("inherited get 3");
    return "inherited";
  },
  set 3(value) {
    log.push("inherited set 3 to " + describe(value));
  },
};

const readOnlyAhead = Object.defineProperty({ __proto__: Array.prototype }, 3, { value: "fixed above", writable: false });

const makers = {
  "a getter": withAGetter,
  "a getter and a setter": withAGetterAndASetter,
  "only a setter": withOnlyASetter,
  "a read-only element": () => Object.defineProperty([3, 1, 2], 1, { writable: false }),
  "a hidden element": () => Object.defineProperty([3, 1, 2], 1, { enumerable: false }),
  "a fixed element": () => Object.defineProperty([3, 1, 2], 1, { configurable: false }),
  "a setter past the end on the prototype": () => Object.setPrototypeOf([3, 1, 2], catching),
  "a read-only element past the end on the prototype": () => Object.setPrototypeOf([3, 1, 2], readOnlyAhead),
  "an array": () => [3, 1, 2],
};

const uses = {
  sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  forOf(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  spread: list => [...list],
  pattern(list) {
    const [, second] = list;
    return second;
  },
  map: list => list.map(value => value),
  slice: list => list.slice(),
  join: list => list.join(),
  includes: list => list.includes(10),
  keys: list => Object.keys(list),
  json: list => JSON.stringify(list),
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([3, 1, 2]);

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    const list = makers[name]();
    attempt(name + ", " + use, () => uses[use](list));
    console.log("  log: " + log.join(", ") + "; left " + describe(list));
  }
}

module.exports = uses;
