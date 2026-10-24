function show(value) {
  if (typeof value === "object" && value !== null) return value.constructor ? value.constructor.name : "object";
  return typeof value + " " + String(value);
}

function attempt(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function remember(store, key, value) {
  if (store.has(key)) return store.get(key);
  store.set(key, value);
  return store.get(key);
}

function forget(store, key) {
  const had = store.has(key);
  store.delete(key);
  return had + " " + store.has(key);
}

function addTwice(bag, value) {
  bag.add(value);
  bag.add(value);
  return bag.has(value);
}

function countEach(store) {
  let count = 0;
  store.forEach(() => count++);
  return count;
}

const honest = new Map();
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += remember(honest, "k" + (i & 63), i);
  if ((i & 255) === 0) forget(honest, "k1");
}
const honestBag = new Set();
for (let i = 0; i < 2000; i++) addTwice(honestBag, i & 63);
console.log("2000 honest rounds:", warm, honest.size, honestBag.size, countEach(honest), countEach(honestBag));

class Ledger {
  constructor() {
    this.entries = {};
    this.log = [];
  }
  has(key) {
    this.log.push("has");
    return key in this.entries;
  }
  get(key) {
    this.log.push("get");
    return this.entries[key];
  }
  set(key, value) {
    this.log.push("set");
    this.entries[key] = value + "!";
  }
  delete(key) {
    this.log.push("delete");
    return delete this.entries[key];
  }
  add(value) {
    this.log.push("add");
    this.entries[value] = true;
  }
  forEach(callback) {
    this.log.push("forEach");
    for (const key in this.entries) callback(this.entries[key], key);
  }
}

class LoudMap extends Map {
  get(key) {
    return "loud " + super.get(key);
  }
  has() {
    return false;
  }
}

const key = {};
const stores = {
  "a Map": () => new Map(),
  "a WeakMap": () => new WeakMap(),
  "a Set": () => new Set(),
  "a WeakSet": () => new WeakSet(),
  "a class of the program": () => new Ledger(),
  "an object literal": () => ({ has: () => true, get: () => "literal", set() {}, delete() {}, add() {}, forEach() {} }),
  "a subclass of Map": () => new LoudMap(),
  "a Map with a get of its own": () => Object.assign(new Map(), { get: () => "own" }),
  "a Map under another prototype": () => Object.setPrototypeOf(new Map(), Ledger.prototype),
  "an object under Map.prototype": () => Object.create(Map.prototype),
  "a proxy of a Map": () => new Proxy(new Map(), {}),
  "a proxy that binds the methods": () =>
    new Proxy(new Map(), {
      get: (target, name) => (typeof target[name] === "function" ? target[name].bind(target) : target[name]),
    }),
  URLSearchParams: () => new URLSearchParams(),
  Headers: () => new Headers(),
  FormData: () => new FormData(),
  "an array": () => [],
  "a string": () => "text",
  null: () => null,
};

for (const [name, make] of Object.entries(stores)) {
  for (const [kind, used] of [
    ["a string key", "k"],
    ["an object key", key],
  ]) {
    const store = make();
    console.log(
      name + ", " + kind + ":",
      "remember",
      attempt(() => remember(store, used, "v")),
      "| again",
      attempt(() => remember(store, used, "w")),
      "| forget",
      attempt(() => forget(store, used)),
      "| add",
      attempt(() => addTwice(store, used)),
      "| each",
      attempt(() => countEach(store)),
      "| log",
      store && store.log ? store.log.join() : "none",
    );
  }
}

console.log(
  "honest again:",
  remember(honest, "k2", 0),
  forget(honest, "k2"),
  addTwice(honestBag, 99),
  countEach(honestBag),
);
