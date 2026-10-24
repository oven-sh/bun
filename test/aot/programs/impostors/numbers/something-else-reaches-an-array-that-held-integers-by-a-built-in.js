function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function xor(list) {
  let bits = 0;
  for (let i = 0; i < list.length; i++) bits ^= list[i];
  return bits;
}

function second(list) {
  return list[1];
}

function secondPlusOne(list) {
  return list[1] + 1;
}

const late = [0.5, NaN, 2147483648, -0, Infinity, "3", undefined, null, true, 3n, [4], { valueOf: () => 5 }, Symbol("s")];
const ways = {
  "a store past the end": (list, value) => {
    list[6] = value;
  },
  "Object.defineProperty": (list, value) => {
    Object.defineProperty(list, 1, { value, writable: true, enumerable: true, configurable: true });
  },
  "Reflect.set": (list, value) => {
    Reflect.set(list, 1, value);
  },
  "a getter": (list, value) => {
    Object.defineProperty(list, 1, { get: () => value, configurable: true });
  },
  "copyWithin from a pushed value": (list, value) => {
    list.push(value);
    list.copyWithin(1, list.length - 1);
  },
};

const shared = [1, 2, 3, 4];
for (let i = 0; i < 2000; i++) {
  shared[i & 3] = i;
  sum(shared);
  xor(shared);
  second(shared);
  secondPlusOne(shared);
}
console.log("after 2000 honest rounds", show(shared));

for (const way of Object.keys(ways)) {
  for (const value of late) {
    const list = [1, 2, 3, 4];
    sum(list);
    ways[way](list, value);
    const label = way + " of " + show(value);
    attempt(label + " list", () => list);
    attempt(label + " sum", () => sum(list));
    attempt(label + " xor", () => xor(list));
    attempt(label + " second", () => [second(list), secondPlusOne(list)]);
  }
}
