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

class Basket {
  constructor() {
    this.items = [3, 1, 2];
    this.name = "basket";
  }
  add(value) {
    return this.items.push(value);
  }
  total() {
    let sum = 0;
    for (let i = 0; i < this.items.length; i++) sum += this.items[i];
    return sum;
  }
  walk() {
    const seen = [];
    for (const value of this.items) seen.push(value);
    return seen;
  }
  doubled() {
    return this.items.map(value => value * 2);
  }
  count() {
    return this.items.length;
  }
  first() {
    const [first] = this.items;
    return first;
  }
  copy() {
    return [...this.items];
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

const impostors = {
  "an array-like": () => ({ 0: 7, 1: 8, length: 2 }),
  "a subclass": () => Loud.of(7, 8),
  "a string": () => "78",
  "a Set": () => new Set([7, 8]),
  "a typed array": () => new Uint8Array([7, 8]),
  "undefined": () => undefined,
  "a frozen array": () => Object.freeze([7, 8]),
  "doubles": () => [7.5, 8.5],
};

const key = ["it", "ems"].join("");

const stores = {
  "a computed name": (basket, value) => { basket[key] = value; },
  "Object.assign": (basket, value) => { Object.assign(basket, { items: value }); },
  "Object.assign from JSON and a patch": (basket, value) => { Object.assign(basket, JSON.parse('{"name":"patched"}'), { [key]: value }); },
  "Reflect.set": (basket, value) => { Reflect.set(basket, "items", value); },
  "Object.defineProperty": (basket, value) => { Object.defineProperty(basket, "items", { value }); },
  "a getter": (basket, value) => { Object.defineProperty(basket, "items", { get: () => value }); },
  "a pattern": (basket, value) => { [basket.items] = [value]; },
  "an object pattern": (basket, value) => { ({ list: basket.items } = { list: value }); },
  "a for-of head": (basket, value) => { for (basket.items of [value]); },
  "a for-in head over a computed name": (basket, value) => { for (const name in { items: 1 }) basket[name] = value; },
  "Object.entries": (basket, value) => { for (const [name, held] of Object.entries({ items: value })) basket[name] = held; },
  "a proxy of the object": (basket, value) => { new Proxy(basket, {}).items = value; },
  "a deletion over a prototype": (basket, value) => { delete basket.items; Object.setPrototypeOf(basket, { __proto__: Basket.prototype, items: value }); },
  "a plain store": (basket, value) => { basket.items = value; },
};

const calls = {
  add: basket => basket.add(9),
  total: basket => basket.total(),
  walk: basket => basket.walk(),
  doubled: basket => basket.doubled(),
  count: basket => basket.count(),
  first: basket => basket.first(),
  copy: basket => basket.copy(),
  outside: basket => basket.items.length + ":" + basket.items[0],
};

for (let i = 0; i < 2000; i++) {
  const basket = new Basket();
  for (const call in calls) calls[call](basket);
}

for (const store in stores) {
  for (const name in impostors) {
    const answers = [];
    for (const call in calls) {
      const basket = new Basket();
      stores[store](basket, impostors[name]());
      try {
        answers.push(call + " " + describe(calls[call](basket)));
      } catch (error) {
        answers.push(call + " threw " + error.constructor.name);
      }
    }
    console.log(store + ", " + name + ": " + answers.join("; "));
  }
  const honest = new Basket();
  console.log(store + ", then an untouched basket: " + Object.keys(calls).map(call => describe(calls[call](honest))).join("; "));
}
