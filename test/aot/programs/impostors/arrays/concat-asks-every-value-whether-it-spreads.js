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

class NeverSpread extends Array {
  get [Symbol.isConcatSpreadable]() {
    log.push("asked the subclass");
    return false;
  }
}

function spreadable(value, answer) {
  return Object.defineProperty(value, Symbol.isConcatSpreadable, { value: answer, configurable: true });
}

function revoked() {
  const pair = Proxy.revocable([7, 8], {});
  pair.revoke();
  return pair.proxy;
}

const values = {
  "an array": () => [7, 8],
  "an empty array": () => [],
  "doubles": () => [7.5, 8.5],
  "strings": () => ["seven"],
  "an array with a hole": () => [7, , 8],
  "only a hole": () => [,],
  "a hole over an inherited element": () => Object.setPrototypeOf([7, , 8], { __proto__: Array.prototype, 1: "inherited" }),
  "an array with a getter": () => Object.defineProperty([7, 8], 0, { get() { log.push("get 0"); return "got"; }, enumerable: true }),
  "an array that says false": () => spreadable([7, 8], false),
  "an array that says undefined": () => spreadable([7, 8], undefined),
  "an array that says null": () => spreadable([7, 8], null),
  "an array that says 0": () => spreadable([7, 8], 0),
  "an array that says text": () => spreadable([7, 8], "yes"),
  "an array whose answer is a getter": () => Object.defineProperty([7, 8], Symbol.isConcatSpreadable, { get() { log.push("asked"); return true; } }),
  "an array whose answer throws": () => Object.defineProperty([7, 8], Symbol.isConcatSpreadable, { get() { throw new RangeError("asked"); } }),
  "a subclass": () => new (class extends Array {})(7, 8),
  "a subclass that never spreads": () => NeverSpread.of(7, 8),
  "an array under null": () => Object.setPrototypeOf([7, 8], null),
  "a frozen array": () => Object.freeze([7, 8]),
  "a proxy of an array": () => new Proxy([7, 8], {}),
  "a revoked proxy": revoked,
  "an array-like": () => ({ 0: 7, 1: 8, length: 2 }),
  "an array-like that says true": () => spreadable({ 0: 7, 1: 8, length: 2 }, true),
  "an array-like that says true and has no length": () => spreadable({ 0: 7 }, true),
  "an array-like that says true and is too short": () => spreadable({ 0: 7, length: 3 }, true),
  "an array-like that says true with a negative length": () => spreadable({ 0: 7, length: -1 }, true),
  "an array-like that says true with a fractional length": () => spreadable({ 0: 7, 1: 8, length: 1.9 }, true),
  "arguments": () => (function () { return arguments; })(7, 8),
  "arguments that say true": () => spreadable((function () { return arguments; })(7, 8), true),
  "a typed array": () => new Uint8Array([7, 8]),
  "a typed array that says true": () => spreadable(new Uint8Array([7, 8]), true),
  "a string": () => "78",
  "a String object that says true": () => spreadable(new String("78"), true),
  "a Set": () => new Set([7, 8]),
  "a function that says true": () => spreadable(function (a, b) {}, true),
  "a number": () => 78,
  "null": () => null,
  "undefined": () => undefined,
};

const uses = {
  given: value => [1].concat(value),
  givenToAnEmptyArray: value => [].concat(value),
  givenTwice: value => [1].concat(value, value),
  givenBetween: value => [1.5].concat("a", value, [2]),
  receiver: value => Array.prototype.concat.call(value, [1]),
  spreadOfGiven: value => [].concat(...[value, value]),
};

function summary(result) {
  const parts = [];
  for (let i = 0; i < result.length && i < 12; i++) parts.push(i in result ? (typeof result[i] === "object" && result[i] !== null ? "<" + Object.prototype.toString.call(result[i]).slice(8, -1) + ">" : typeof result[i] === "function" ? "<function>" : describe(result[i])) : "hole");
  return result.constructor.name + " of " + result.length + ": " + parts.join(", ");
}

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([7, 8]);

for (const name in values) {
  for (const use in uses) {
    log.length = 0;
    let answer;
    try {
      answer = summary(uses[use](values[name]()));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + use + ": " + answer + (log.length ? " after " + log.join(", ") : ""));
  }
}

attempt("an array-like that says true and is as long as can be", () => [1].concat(spreadable({ length: 2 ** 53 - 1 }, true)));
