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

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const log = [];
const logging = {
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    log.push("set " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    log.push("has " + String(key));
    return Reflect.has(target, key);
  },
};

function revoked() {
  const pair = Proxy.revocable([3, 1, 2], {});
  pair.revoke();
  return pair.proxy;
}

const makers = {
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "a logging proxy": () => new Proxy([3, 1, 2], logging),
  "a proxy of a proxy": () => new Proxy(new Proxy([3, 1, 2], {}), logging),
  "a proxy that lies about the length": () => new Proxy([3, 1, 2], { get: (target, key, receiver) => (key === "length" ? 1 : Reflect.get(target, key, receiver)) }),
  "a proxy that answers 7 for every index": () => new Proxy([3, 1, 2], { get: (target, key, receiver) => (typeof key === "string" && key >= 0 ? 7 : Reflect.get(target, key, receiver)) }),
  "a revoked proxy": revoked,
  "a subclass": () => Loud.of(3, 1, 2),
  "an array under null": () => Object.setPrototypeOf([3, 1, 2], null),
  "an array under Object.prototype": () => Reflect.construct(Array, [3, 1, 2], Object),
  "an array under a typed array's prototype": () => Reflect.construct(Array, [3, 1, 2], Uint8Array),
  "an array with its own members": () => Object.assign([3, 1, 2], { push: () => "its own push", map: () => "its own map" }),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "an array with a getter": () => Object.defineProperty([3, 1, 2], 0, { get: () => "got" }),
  "an array-like under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "arguments": () => (function () { return arguments; })(3, 1, 2),
  "an array": () => [3, 1, 2],
};

function lengthIfArray(value) {
  if (Array.isArray(value)) return value.length;
  return "not an array";
}

function firstIfArray(value) {
  return Array.isArray(value) ? value[0] : "not an array";
}

function pushIfArray(value) {
  if (!Array.isArray(value)) return "not an array";
  return value.push(9);
}

function sumIfArray(value) {
  if (!Array.isArray(value)) return "not an array";
  let total = 0;
  for (let i = 0; i < value.length; i++) total += value[i];
  return total;
}

function copyIfArray(value) {
  return Array.isArray(value) ? [...value] : "not an array";
}

function doubleIfArray(value) {
  return Array.isArray(value) ? value.map(element => element * 2) : "not an array";
}

function storeIfArray(value) {
  if (Array.isArray(value)) value[1] = "stored";
  return Array.isArray(value) && 1 in value ? value[1] : "not an array";
}

const uses = { lengthIfArray, firstIfArray, pushIfArray, sumIfArray, copyIfArray, doubleIfArray, storeIfArray };

function round(title) {
  for (const name in makers) {
    for (const use in uses) {
      log.length = 0;
      attempt(title + ", " + use + ", " + name, () => uses[use](makers[name]()));
      if (log.length) console.log("  traps: " + log.join(", "));
    }
  }
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
round("after 2000 arrays");
