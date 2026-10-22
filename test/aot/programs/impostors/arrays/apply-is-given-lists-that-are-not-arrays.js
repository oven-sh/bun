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

function three(a, b, c) {
  return [arguments.length, a, b, c];
}

function gather(...values) {
  return values;
}

function Point(x, y) {
  this.x = x;
  this.y = y;
}

const uses = {
  apply: list => three.apply(null, list),
  applyToRest: list => gather.apply(null, list),
  reflectApply: list => Reflect.apply(three, null, list),
  construct: list => Reflect.construct(Point, list),
  largest: list => Math.max.apply(Math, list),
  text: list => String.fromCharCode.apply(String, list),
  pushAll(list) {
    const target = [0];
    return [Array.prototype.push.apply(target, list), target];
  },
  concatAll: list => Array.prototype.concat.apply([], list),
  forwarded(list) {
    function outer() {
      return three.apply(this, arguments);
    }
    return outer.apply(null, list);
  },
  callApply: list => Function.prototype.call.apply(three, list),
  boundApply: list => three.bind(null, "bound").apply(null, list),
  arrowApply: list => ((a, b) => [a, b]).apply(null, list),
};

const makers = {
  "an array": () => [65, 66, 67],
  "an array-like": () => ({ 0: 65, 1: 66, 2: 67, length: 3 }),
  "an array-like that is too short": () => ({ 0: 65, length: 3 }),
  "an array-like with a fractional length": () => ({ 0: 65, 1: 66, 2: 67, length: 1.9 }),
  "an array-like with a text length": () => ({ 0: 65, 1: 66, length: "2" }),
  "an array-like with a negative length": () => ({ 0: 65, length: -1 }),
  "an array-like with a length of NaN": () => ({ 0: 65, length: NaN }),
  "an object without a length": () => ({ 0: 65 }),
  "an array-like with getters": () => ({
    get length() { log.push("length"); return 2; },
    get 0() { log.push("0"); return 65; },
    get 1() { log.push("1"); return 66; },
  }),
  "an array with a hole": () => [65, , 67],
  "a hole over an inherited element": () => Object.setPrototypeOf([65, , 67], { __proto__: Array.prototype, 1: 90 }),
  "an array with a getter": () => Object.defineProperty([65, 66, 67], 1, { get() { log.push("1"); return 90; } }),
  "arguments": () => (function () { return arguments; })(65, 66, 67),
  "a typed array": () => new Uint8Array([65, 66, 67]),
  "doubles": () => [65.5, 66.5, 67.5],
  "a subclass with its own iterator": () => new (class extends Array { *[Symbol.iterator]() { yield "never used"; } })(65, 66, 67),
  "a proxy": () => new Proxy([65, 66], { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } }),
  "a String object": () => new String("AB"),
  "a function": () => function (a, b) {},
  "a Set": () => new Set([65]),
  "a string": () => "AB",
  "a number": () => 65,
  "null": () => null,
  "undefined": () => undefined,
  "a symbol": () => Symbol.iterator,
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([65, 66, 67]);

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    attempt(name + ", " + use, () => uses[use](makers[name]()));
    if (log.length) console.log("  log: " + log.join(", "));
  }
}

attempt("a list that is far too long", () => three.apply(null, { length: 2 ** 31 }));
attempt("a long list", () => gather.apply(null, new Array(50000)).length);
attempt("a long list of numbers", () => Math.max.apply(null, Array.from({ length: 50000 }, (_, index) => index)));
