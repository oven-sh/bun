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
}

const makers = {
  "an array": () => [3, 1, 2],
  "a subclass": () => Loud.of(3, 1, 2),
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array-like under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array with a hole": () => [3, , 2],
  "an array of holes": () => new Array(3),
  "a hole over an inherited element": () => Object.setPrototypeOf([3, , 2], { __proto__: Array.prototype, 1: "inherited" }),
  "an array with a name": () => Object.assign([3, 1, 2], { name: "kept" }),
  "an array with a getter": () => Object.defineProperty([3, 1, 2], 1, { get: () => "got", enumerable: true }),
  "an array with its own push": () => Object.assign([3, 1, 2], { push: 5 }),
  "an array with a function in it": () => [3, () => 1, 2],
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "an array with a fixed length": () => Object.defineProperty([3, 1, 2], "length", { writable: false }),
  "an array under null": () => Object.setPrototypeOf([3, 1, 2], null),
  "a sparse array": () => { const list = [3]; list[20000] = 2; return list; },
  "an array that holds itself": () => { const list = [3]; list.push(list); return list; },
  "an array that holds one array twice": () => { const inner = [1]; return [inner, inner]; },
  "doubles with a negative zero and NaN": () => [-0, NaN, 1.5],
  "mixed values": () => [3, "1", 2n, null, undefined, new Date(0), /x/g, new Set([1])],
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "a Set": () => new Set([3, 1, 2]),
  "arguments": () => (function () { return arguments; })(3, 1, 2),
  "a String object": () => new String("312"),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "a generator": () => (function* () {})(),
};

const uses = {
  shape: list => [Array.isArray(list), Object.getPrototypeOf(list) === Array.prototype, Object.isFrozen(list), list.length, Object.keys(list).length > 8 ? "many keys" : Object.keys(list).join()],
  push: list => [list.push(9), list.length],
  sum(list) {
    let total = 0;
    for (let i = 0; i < list.length && i < 8; i++) total += list[i];
    return typeof total === "string" ? total.length : total;
  },
  second: list => [1 in list, typeof list[1]],
  walk(list) {
    let count = 0;
    for (const value of list) count++;
    return count;
  },
  map: list => typeof list.map(value => value),
  identity: list => [list[0] === list[1], list[1] === list],
};

for (const use in uses) for (let i = 0; i < 500; i++) uses[use](structuredClone([3, 1, 2]));

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](structuredClone(makers[name]())));
