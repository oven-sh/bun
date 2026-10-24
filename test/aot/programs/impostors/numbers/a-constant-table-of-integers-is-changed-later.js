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

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19];
const WEIGHTS = { small: 1, medium: 2, large: 4 };
const GRID = [
  [1, 2, 3],
  [4, 5, 6],
];
const FROZEN = Object.freeze([1, 2, 3]);
const LIMITS = Object.freeze({ low: 0, high: 10 });

function prime(i) {
  return PRIMES[i];
}

function sumOfPrimes() {
  let total = 0;
  for (let i = 0; i < PRIMES.length; i++) total += PRIMES[i];
  return total;
}

function xorOfPrimes() {
  let bits = 0;
  for (const value of PRIMES) bits ^= value;
  return bits;
}

function weight(name) {
  return WEIGHTS[name] * 2;
}

function totalWeight() {
  return WEIGHTS.small + WEIGHTS.medium + WEIGHTS.large;
}

function cell(y, x) {
  return GRID[y][x] + 1;
}

function frozenSum() {
  return FROZEN[0] + FROZEN[1] + FROZEN[2];
}

function inLimits(n) {
  return n >= LIMITS.low && n <= LIMITS.high;
}

function report() {
  return [prime(1), sumOfPrimes(), xorOfPrimes(), weight("medium"), totalWeight(), cell(1, 1), frozenSum(), inLimits(5), PRIMES.length];
}

for (let i = 0; i < 2000; i++) report();
attempt("before any change", report);

const changes = [
  ["PRIMES[1] = 0.5", () => (PRIMES[1] = 0.5)],
  ["PRIMES[1] = '3'", () => (PRIMES[1] = "3")],
  ["PRIMES[1] = undefined", () => (PRIMES[1] = undefined)],
  ["delete PRIMES[1]", () => delete PRIMES[1]],
  ["PRIMES[1] = 3n", () => (PRIMES[1] = 3n)],
  ["PRIMES[1] = -0", () => (PRIMES[1] = -0)],
  ["PRIMES[1] = 2147483648", () => (PRIMES[1] = 2147483648)],
  ["PRIMES[1] = 3", () => (PRIMES[1] = 3)],
  ["PRIMES.push(23)", () => PRIMES.push(23)],
  ["PRIMES.push('x')", () => PRIMES.push("x")],
  ["PRIMES.length = 3", () => (PRIMES.length = 3)],
  ["PRIMES.reverse()", () => PRIMES.reverse().length],
  ["PRIMES[10] = 1", () => (PRIMES[10] = 1)],
  ["PRIMES.length = 0", () => (PRIMES.length = 0)],
  ["WEIGHTS.medium = '2'", () => (WEIGHTS.medium = "2")],
  ["WEIGHTS.medium = 2.5", () => (WEIGHTS.medium = 2.5)],
  ["delete WEIGHTS.medium", () => delete WEIGHTS.medium],
  ["WEIGHTS.medium = 2", () => (WEIGHTS.medium = 2)],
  ["WEIGHTS.extra = 8", () => (WEIGHTS.extra = 8)],
  ["a getter for WEIGHTS.small", () => Object.keys(Object.defineProperty(WEIGHTS, "small", { get: () => 100, enumerable: true }))],
  ["GRID[1][1] = '5'", () => (GRID[1][1] = "5")],
  ["GRID[1] = [7, 8.5, 9]", () => (GRID[1] = [7, 8.5, 9]).length],
  ["GRID[1] = 'abc'", () => (GRID[1] = "abc")],
  ["FROZEN[0] = 9", () => (FROZEN[0] = 9)],
  ["FROZEN.push(9)", () => FROZEN.push(9)],
  ["LIMITS.high = 1", () => (LIMITS.high = 1)],
];

for (const [label, change] of changes) {
  console.log(label, "->", outcome(change));
  attempt("  then", report);
}
