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

const uses = {
  readLength(list) {
    list.length;
  },
  readFirst(list) {
    list[0];
  },
  readAll(list) {
    for (let i = 0; i < list.length; i++) list[i];
  },
  readAllWithACachedLength(list) {
    for (let i = 0, length = list.length; i < length; i++) list[i];
  },
  ask(list) {
    0 in list;
  },
  walk(list) {
    for (const value of list);
  },
  walkOnce(list) {
    for (const value of list) break;
  },
  spread(list) {
    [...list];
  },
  spreadIntoACall(list) {
    Math.max(...list);
  },
  takeNone(list) {
    const [] = list;
  },
  takeTwo(list) {
    const [a, b] = list;
  },
  takeByName(list) {
    const { length, 0: first } = list;
  },
  map(list) {
    list.map(value => value);
  },
  slice(list) {
    list.slice();
  },
  concat(list) {
    [].concat(list);
  },
  join(list) {
    list.join();
  },
  text(list) {
    `${list}`;
  },
  number(list) {
    +list;
  },
  compare(list) {
    list < 1;
  },
  indexOf(list) {
    list.indexOf(1);
  },
  readPush(list) {
    list.push;
  },
  from(list) {
    Array.from(list);
  },
  keys(list) {
    Object.keys(list);
  },
  unusedLocal(list) {
    const unused = list[1];
    const alsoUnused = list.length + 1;
  },
  deadBranch(list) {
    if (list.length < 0) log.push("never");
  },
  voided(list) {
    void list[0];
  },
  typeOf(list) {
    typeof list[0];
  },
};

function logging(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      log.push("has " + String(key));
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      log.push("keys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

const makers = {
  "a proxy": () => logging([3, 1]),
  "an array with getters": () =>
    Object.defineProperties([3, 1], {
      0: { get() { log.push("get 0"); return 3; }, enumerable: true },
      1: { get() { log.push("get 1"); return 1; }, enumerable: true },
    }),
  "an array-like with getters": () => ({
    get length() { log.push("get length"); return 2; },
    get 0() { log.push("get 0"); return 3; },
    get 1() { log.push("get 1"); return 1; },
    get push() { log.push("get push"); return undefined; },
  }),
  "an array with a getter that throws": () => Object.defineProperty([3, 1], 0, { get() { throw new RangeError("element"); }, enumerable: true }),
  "an array of objects that log": () => [{ toString() { log.push("toString"); return "3"; }, valueOf() { log.push("valueOf"); return 3; } }],
  "an iterable that logs": () => ({
    [Symbol.iterator]() {
      log.push("iterator");
      return { next() { log.push("next"); return { done: true }; }, return() { log.push("return"); return {}; } };
    },
  }),
  "a subclass that logs": () => new (class extends Array {
    static get [Symbol.species]() { log.push("species"); return Array; }
    [Symbol.iterator]() { log.push("iterator"); return super[Symbol.iterator](); }
  })(3, 1),
  "null": () => null,
  "undefined": () => undefined,
  "a number": () => 5,
  "a symbol": () => Symbol("list"),
  "an array": () => [3, 1],
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([3, 1]);

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    let answer = "returned";
    try {
      uses[use](makers[name]());
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + use + ": " + answer + (log.length ? " after " + log.join(", ") : ""));
  }
}
