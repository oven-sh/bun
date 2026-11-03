// The result of Object.getOwnPropertyDescriptor is only read by name or tested for being there, so no object is made for it; where it goes anywhere else it is an object as ever.
// CALLS- valueOf operationAOTGetOwnPropertyDescriptor\b
// CALLS- partsOf operationAOTGetOwnPropertyDescriptor\b
// CALLS- isAccessor operationAOTGetOwnPropertyDescriptor\b
// CALLS- valueIfThere operationAOTGetOwnPropertyDescriptor\b
// CALLS+ handedOn operationAOTGetOwnPropertyDescriptor\b
// CALLS+ written operationAOTGetOwnPropertyDescriptor\b
// CALLS+ joined operationAOTGetOwnPropertyDescriptor\b
function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
function attempt(f) {
  try {
    return f();
  } catch (error) {
    return "THROWS " + error.name;
  }
}

// Each has a loop, so that it counts as warm, and is called through an array, so that it stays a function.
function valueOf(object, key) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    result = descriptor.value;
  }
  return result;
}
function partsOf(object, key) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor === undefined) return "none";
    result = [descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable, descriptor.get, descriptor.set].map(show).join(" ");
  }
  return result;
}
function isAccessor(object, key) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    result = !!descriptor && (typeof descriptor.get === "function" || typeof descriptor.set === "function");
  }
  return result;
}
function valueIfThere(object, key) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return "absent";
    if (descriptor == null) return "never";
    result = descriptor?.value;
  }
  return result;
}
function handedOn(object, key) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    result = show(descriptor);
  }
  return result;
}
function written(object, key) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    descriptor.value = 5;
    result = descriptor.value + " " + object[key];
  }
  return result;
}
function joined(object, key, other) {
  let result;
  for (let i = 0; i < 2; i++) {
    const descriptor = other ? { value: "other" } : Object.getOwnPropertyDescriptor(object, key);
    result = descriptor.value;
  }
  return result;
}

const symbol = Symbol("key");
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get sum() {
    return this.x + this.y;
  }
  static origin = "here";
}
const plain = {
  a: 1,
  get both() {
    throw new Error("a getter ran");
  },
  set both(value) {},
  get onlyGet() {
    throw new Error("a getter ran");
  },
  set onlySet(value) {},
  [symbol]: "by symbol",
  7: "seven",
  undefinedValue: undefined,
};
Object.defineProperty(plain, "hidden", { value: "h", enumerable: false, writable: true, configurable: true });
Object.defineProperty(plain, "fixed", { value: "f", enumerable: true, writable: false, configurable: false });
const frozen = Object.freeze({ a: 1, b: [2] });
const sealed = Object.seal({ a: 1 });
const log = [];
const proxy = new Proxy(
  { a: 1 },
  {
    getOwnPropertyDescriptor(target, key) {
      log.push("trap " + String(key));
      return key === "made" ? { value: "up", configurable: true } : Reflect.getOwnPropertyDescriptor(target, key);
    },
  },
);
const many = {};
for (let i = 0; i < 40; i++) many["k" + i] = i;

const cases = [
  [plain, "a"], [plain, "both"], [plain, "onlyGet"], [plain, "onlySet"], [plain, symbol], [plain, 7], [plain, "7"], [plain, "undefinedValue"], [plain, "hidden"], [plain, "fixed"], [plain, "missing"], [plain, "toString"],
  [frozen, "a"], [frozen, "b"], [sealed, "a"], [new Point(1, 2), "x"], [new Point(1, 2), "sum"], [Point.prototype, "sum"], [Point.prototype, "constructor"], [Point, "origin"], [Point, "prototype"], [Point, "name"], [Point, "length"],
  [[10, 20], "0"], [[10, 20], 1], [[10, 20], 2], [[10, 20], "length"], [[, 1], 0], [Object.freeze([1]), 0], ["text", 0], ["text", "length"], ["text", 9], [5, "a"], [true, "a"], [show, "name"], [show, "length"], [show, "prototype"],
  [new Map(), "size"], [new Uint8Array(2), 0], [new Uint8Array(2), 5], [/x/g, "lastIndex"], [new Error("m"), "message"], [many, "k39"], [many, "k40"], [proxy, "a"], [proxy, "made"], [proxy, "none"],
  [Object.create({ inherited: 1 }), "inherited"], [Object.create(null, { own: { value: 1 } }), "own"], [globalThis, "undefined"], [Math, "PI"], [null, "a"], [undefined, "a"],
];
for (let round = 0; round < 3; round++) {
  for (const [object, key] of cases) {
    const line = [valueOf, partsOf, isAccessor, valueIfThere, handedOn].map(f => attempt(() => show(f(object, key)))).join(" | ");
    if (round === 2) console.log(show(key), ":", line);
  }
}
console.log(log.length, log.slice(0, 6).join(","));
const others = [written, joined];
console.log(others[0]({ a: 1 }, "a"), attempt(() => others[0]({}, "a")), others[1]({ a: 1 }, "a", false), others[1]({ a: 1 }, "a", true));

const order = [];
const key = {
  toString() {
    order.push("key");
    return "a";
  },
};
const byValue = [valueOf][0];
console.log(byValue({ a: "by an object" }, key), attempt(() => byValue(null, key)), order.join(","));
console.log(attempt(() => byValue({}, { toString() { throw new RangeError("no key"); } })));

function changedBetween(object) {
  const before = Object.getOwnPropertyDescriptor(object, "a");
  object.a = "new";
  Object.defineProperty(object, "a", { enumerable: false });
  const after = Object.getOwnPropertyDescriptor(object, "a");
  return [before.value, before.enumerable, after.value, after.enumerable].join(" ");
}
console.log(changedBetween({ a: "old" }));

function nested(outer, inner) {
  const first = Object.getOwnPropertyDescriptor(outer, "a");
  const second = Object.getOwnPropertyDescriptor(inner, "get");
  return [first.value, typeof first.get, second.value, second.get === undefined, first.writable, second.writable].join(" ");
}
console.log(nested({ a: 1 }, Object.freeze({ get: 2 })), nested({ get a() { return 1; } }, { get: 3 }));

function sumOfOwnValues(object) {
  let sum = 0;
  for (const name of Object.getOwnPropertyNames(object)) {
    const { value, get } = Object.getOwnPropertyDescriptor(object, name);
    if (!get && typeof value === "number") sum += value;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 2000; i++) total += sumOfOwnValues(i % 3 ? new Point(i, 1) : i % 2 ? { a: i, get b() { return 1; }, c: "x" } : [i, i, "s"]);
console.log(total);
