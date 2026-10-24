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

const log = [];

function logged(name, result) {
  return {
    [Symbol.toPrimitive](hint) {
      log.push(name + ":" + hint);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const operators = {
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  remainder: (a, b) => a % b,
  power: (a, b) => a ** b,
  add: (a, b) => a + b,
  less: (a, b) => a < b,
  atMost: (a, b) => a <= b,
  more: (a, b) => a > b,
  atLeast: (a, b) => a >= b,
  looselyEqual: (a, b) => a == b,
  strictlyEqual: (a, b) => a === b,
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
  shiftLeft: (a, b) => a << b,
  shiftRight: (a, b) => a >> b,
  shiftRightUnsigned: (a, b) => a >>> b,
  max: (a, b) => Math.max(a, b),
  min: (a, b) => Math.min(a, b),
  pow: (a, b) => Math.pow(a, b),
  atan2: (a, b) => Math.atan2(a, b),
  imul: (a, b) => Math.imul(a, b),
  hypot: (a, b) => Math.hypot(a, b),
};

const pairs = [
  ["numbers", () => [logged("left", 7), logged("right", 2)]],
  ["strings", () => [logged("left", "7"), logged("right", "2")]],
  ["a number and a bigint", () => [logged("left", 7), logged("right", 2n)]],
  ["bigints", () => [logged("left", 7n), logged("right", 2n)]],
  ["the left one throws", () => [logged("left", new RangeError("left")), logged("right", 2)]],
  ["the right one throws", () => [logged("left", 7), logged("right", new EvalError("right"))]],
  ["a symbol on the left", () => [logged("left", Symbol("s")), logged("right", 2)]],
  ["a symbol on the right", () => [logged("left", 7), logged("right", Symbol("s"))]],
  ["a plain number on the left", () => [7, logged("right", 2)]],
  ["a plain number on the right", () => [logged("left", 7), 2]],
];

for (const name of Object.keys(operators)) {
  for (let i = 0; i < 300; i++) operators[name](i, 3);
  for (const [label, make] of pairs) {
    log.length = 0;
    const [a, b] = make();
    const result = outcome(() => operators[name](a, b));
    console.log(name, "of", label, "->", result, "after", log.join(", ") || "nothing");
  }
}
