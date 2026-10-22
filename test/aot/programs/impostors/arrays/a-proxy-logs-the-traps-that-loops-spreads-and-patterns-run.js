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

function note(trap, key) {
  log.push(key === undefined ? trap : trap + " " + String(key));
}

const handler = {
  get(target, key, receiver) {
    note("get", key);
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    note("set", key);
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    note("has", key);
    return Reflect.has(target, key);
  },
  deleteProperty(target, key) {
    note("delete", key);
    return Reflect.deleteProperty(target, key);
  },
  defineProperty(target, key, descriptor) {
    note("define", key);
    return Reflect.defineProperty(target, key, descriptor);
  },
  getOwnPropertyDescriptor(target, key) {
    note("describe", key);
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  ownKeys(target) {
    note("keys");
    return Reflect.ownKeys(target);
  },
  getPrototypeOf(target) {
    note("prototype");
    return Reflect.getPrototypeOf(target);
  },
};

const uses = {
  sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  sumWithACachedLength(list) {
    let total = 0;
    for (let i = 0, length = list.length; i < length; i++) total += list[i];
    return total;
  },
  renumber(list) {
    for (let i = 0; i < list.length; i++) list[i] = i;
    return "done";
  },
  increment(list) {
    for (let i = 0; i < list.length; i++) list[i]++;
    return "done";
  },
  append(list) {
    list[list.length] = 9;
    return "done";
  },
  present(list) {
    let count = 0;
    for (let i = 0; i < list.length; i++) if (i in list) count++;
    return count;
  },
  truncate(list) {
    list.length = 1;
    return "done";
  },
  remove(list) {
    return delete list[1];
  },
  forOf(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  forOfWithABreak(list) {
    for (const value of list) return value;
  },
  forIn(list) {
    const seen = [];
    for (const key in list) seen.push(key);
    return seen;
  },
  spread(list) {
    return [...list];
  },
  spreadIntoACall(list) {
    return Math.max(...list);
  },
  pattern(list) {
    const [a, b] = list;
    return [a, b];
  },
  patternWithARest(list) {
    const [a, ...rest] = list;
    return [a, rest];
  },
  patternByName(list) {
    const { 0: first, length } = list;
    return [first, length];
  },
  objectSpread(list) {
    return { ...list };
  },
  from(list) {
    return Array.from(list);
  },
  isArray(list) {
    return Array.isArray(list);
  },
  instance(list) {
    return list instanceof Array;
  },
  optional(list) {
    return list?.[0];
  },
  text(list) {
    return "" + list;
  },
  json(list) {
    return JSON.stringify(list);
  },
};

function round(title) {
  for (const use in uses) {
    log.length = 0;
    const target = [3, 1, 2];
    attempt(title + ", " + use, () => uses[use](new Proxy(target, handler)));
    console.log("  traps: " + log.join(", "));
    console.log("  target: " + describe(target));
  }
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
round("after 2000 arrays");
