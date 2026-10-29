const show = object => Reflect.ownKeys(object).map(key => String(key) + "=" + JSON.stringify(object[key])).join(",");
const symbol = Symbol.for("rest");

function constantKeys(s) {
  const { a, b, ...rest } = s;
  return [a, b, show(rest)];
}
function computedKey(s, k) {
  const { a, [k]: b, ...rest } = s;
  return [a, b, show(rest)];
}
function numericKey(s) {
  const { 0: zero, a, ...rest } = s;
  return [zero, a, show(rest)];
}
function onlyRest(s) {
  const { ...rest } = s;
  return show(rest);
}

const sources = [
  { a: 1, b: 2, c: 3 },
  { c: 3, b: 2, a: 1, d: 4 },
  { a: 1, [symbol]: 2, c: 3 },
  { 0: "zero", 1: "one", a: 1, c: 3 },
  ["x", "y"],
  "text",
  5,
  Object.create({ a: "inherited" }, { c: { value: 3, enumerable: true }, hidden: { value: 4 } }),
];
const keys = ["b", "c", "missing", symbol, 0, "0", 1.5];

for (let round = 0; round < 3; round++) {
  for (const s of sources) {
    console.log("constant", constantKeys(s).join(" "));
    console.log("numeric", numericKey(s).join(" "));
    console.log("only rest", onlyRest(s));
    for (const k of keys) console.log("computed", String(k), computedKey(s, k).map(String).join(" "));
  }
}

const log = [];
const loggingKey = {
  toString() {
    log.push("toString");
    return "b";
  },
};
const loggingSource = {
  a: 1,
  get b() {
    log.push("get b");
    return 2;
  },
  get c() {
    log.push("get c");
    return 3;
  },
};
console.log("key object", computedKey(loggingSource, loggingKey).join(" "), log.join(","));

const throwingKey = {
  toString() {
    throw new RangeError("no key");
  },
};
try {
  computedKey(loggingSource, throwingKey);
} catch (error) {
  console.log(error.name, error.message);
}

const proxyLog = [];
const proxy = new Proxy(
  { a: 1, b: 2, c: 3 },
  {
    ownKeys(target) {
      proxyLog.push("ownKeys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      proxyLog.push("getOwnPropertyDescriptor " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key) {
      proxyLog.push("get " + String(key));
      return target[key];
    },
  },
);
console.log("proxy", constantKeys(proxy).join(" "), proxyLog.join(","));

for (const nullish of [null, undefined]) {
  for (const attempt of [() => constantKeys(nullish), () => computedKey(nullish, "a"), () => onlyRest(nullish)]) {
    try {
      attempt();
      console.log("no error");
    } catch (error) {
      console.log(error.name);
    }
  }
}

for (let round = 0; round < 3; round++) {
  const { absent, ...rest } = { a: 1, b: 2 };
  console.log("absent name", absent, show(rest));
}
