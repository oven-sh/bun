const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
];

class PushesSupplier {
  get supplied() {
    return [5, 6];
  }
}
const pushesSupplier = new PushesSupplier();
const keptPushes = Object.getOwnPropertyDescriptor(PushesSupplier.prototype, "supplied");
function pushesSupplied() {
  const a = pushesSupplier.supplied;
  a.push(1);
  return a.length;
}
function pushes(given, isHonest) {
  if (isHonest) return pushesSupplied();
  Object.defineProperty(PushesSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return pushesSupplied();
  } finally {
    Object.defineProperty(PushesSupplier.prototype, "supplied", keptPushes);
  }
}

class IteratesSupplier {
  get supplied() {
    return [5, 6];
  }
}
const iteratesSupplier = new IteratesSupplier();
const keptIterates = Object.getOwnPropertyDescriptor(IteratesSupplier.prototype, "supplied");
function iteratesSupplied() {
  const a = iteratesSupplier.supplied;
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
function iterates(given, isHonest) {
  if (isHonest) return iteratesSupplied();
  Object.defineProperty(IteratesSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return iteratesSupplied();
  } finally {
    Object.defineProperty(IteratesSupplier.prototype, "supplied", keptIterates);
  }
}

class ReadsCharCodeSupplier {
  get supplied() {
    return "abc";
  }
}
const readsCharCodeSupplier = new ReadsCharCodeSupplier();
const keptReadsCharCode = Object.getOwnPropertyDescriptor(ReadsCharCodeSupplier.prototype, "supplied");
function readsCharCodeSupplied() {
  const s = readsCharCodeSupplier.supplied;
  return s.charCodeAt(0);
}
function readsCharCode(given, isHonest) {
  if (isHonest) return readsCharCodeSupplied();
  Object.defineProperty(ReadsCharCodeSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return readsCharCodeSupplied();
  } finally {
    Object.defineProperty(ReadsCharCodeSupplier.prototype, "supplied", keptReadsCharCode);
  }
}

class TruncatesSupplier {
  get supplied() {
    return 7;
  }
}
const truncatesSupplier = new TruncatesSupplier();
const keptTruncates = Object.getOwnPropertyDescriptor(TruncatesSupplier.prototype, "supplied");
function truncatesSupplied() {
  const n = truncatesSupplier.supplied;
  return n | 0;
}
function truncates(given, isHonest) {
  if (isHonest) return truncatesSupplied();
  Object.defineProperty(TruncatesSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return truncatesSupplied();
  } finally {
    Object.defineProperty(TruncatesSupplier.prototype, "supplied", keptTruncates);
  }
}

class AddsOneSupplier {
  get supplied() {
    return 7;
  }
}
const addsOneSupplier = new AddsOneSupplier();
const keptAddsOne = Object.getOwnPropertyDescriptor(AddsOneSupplier.prototype, "supplied");
function addsOneSupplied() {
  const n = addsOneSupplier.supplied;
  return n + 1;
}
function addsOne(given, isHonest) {
  if (isHonest) return addsOneSupplied();
  Object.defineProperty(AddsOneSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return addsOneSupplied();
  } finally {
    Object.defineProperty(AddsOneSupplier.prototype, "supplied", keptAddsOne);
  }
}

class CallsSupplier {
  get supplied() {
    return x => x + 1;
  }
}
const callsSupplier = new CallsSupplier();
const keptCalls = Object.getOwnPropertyDescriptor(CallsSupplier.prototype, "supplied");
function callsSupplied() {
  const f = callsSupplier.supplied;
  return f(1);
}
function calls(given, isHonest) {
  if (isHonest) return callsSupplied();
  Object.defineProperty(CallsSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return callsSupplied();
  } finally {
    Object.defineProperty(CallsSupplier.prototype, "supplied", keptCalls);
  }
}

class AddsMembersSupplier {
  get supplied() {
    return ({ x: 1, y: 2 });
  }
}
const addsMembersSupplier = new AddsMembersSupplier();
const keptAddsMembers = Object.getOwnPropertyDescriptor(AddsMembersSupplier.prototype, "supplied");
function addsMembersSupplied() {
  const o = addsMembersSupplier.supplied;
  return o.x + o.y;
}
function addsMembers(given, isHonest) {
  if (isHonest) return addsMembersSupplied();
  Object.defineProperty(AddsMembersSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return addsMembersSupplied();
  } finally {
    Object.defineProperty(AddsMembersSupplier.prototype, "supplied", keptAddsMembers);
  }
}

class StoresMemberSupplier {
  get supplied() {
    return ({ x: 1, y: 2 });
  }
}
const storesMemberSupplier = new StoresMemberSupplier();
const keptStoresMember = Object.getOwnPropertyDescriptor(StoresMemberSupplier.prototype, "supplied");
function storesMemberSupplied() {
  const o = storesMemberSupplier.supplied;
  o.x = 1;
  return o;
}
function storesMember(given, isHonest) {
  if (isHonest) return storesMemberSupplied();
  Object.defineProperty(StoresMemberSupplier.prototype, "supplied", { value: given, configurable: true });
  try {
    return storesMemberSupplied();
  } finally {
    Object.defineProperty(StoresMemberSupplier.prototype, "supplied", keptStoresMember);
  }
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(make(), label === values[0][0]));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes([5, 6], true);
  iterates([5, 6], true);
  readsCharCode("abc", true);
  truncates(7, true);
  addsOne(7, true);
  calls(x => x + 1, true);
  addsMembers(({ x: 1, y: 2 }), true);
  storesMember(({ x: 1, y: 2 }), true);
}
everyCase("after 2000");
