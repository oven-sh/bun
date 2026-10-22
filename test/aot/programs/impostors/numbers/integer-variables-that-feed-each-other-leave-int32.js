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

const marks = ["a", "b", "c", "d"];

function fibonacci(count) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < count; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return [a, b, marks[a & 3], marks[b & 3]];
}

function fibonacciWithoutATemporary(count) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < count; i++) {
    b = a + b;
    a = b - a;
  }
  return [a, b, marks[a & 3], marks[b & 3]];
}

function doubled(count) {
  let x = 1;
  for (let i = 0; i < count; i++) x = x + x;
  return [x, x | 0, marks[x & 3]];
}

function pingPong(count, step) {
  let low = 0;
  let high = 0;
  for (let i = 0; i < count; i++) {
    low = high + 1;
    high = low + step;
  }
  return [low, high, marks[low & 3], marks[high & 3]];
}

function difference(a, b) {
  let x = 0;
  let y = 0;
  let z = 0;
  x = a | 0;
  y = b | 0;
  z = x - y;
  return [z, z | 0, marks[z & 3], z + 1];
}

function triangle(count) {
  let total = 0;
  let i = 0;
  while (i < count) {
    total = total + i;
    i = i + 1;
  }
  return [total, total | 0, marks[total & 3]];
}

function copied(value) {
  let first = 0;
  let second = 0;
  let third = 0;
  first = value;
  second = first;
  third = second;
  return [third, marks[third], third + 1, marks[second & 3], marks[first & 3]];
}

for (let i = 0; i < 300; i++) {
  fibonacci(i % 20);
  fibonacciWithoutATemporary(i % 20);
  doubled(i % 20);
  pingPong(i % 20, 1);
  difference(i, 3);
  triangle(i % 20);
  copied(i & 3);
}

for (const count of [10, 45, 46, 47, 48, 78, 79, 90]) {
  attempt("fibonacci(" + count + ")", () => fibonacci(count));
  attempt("fibonacciWithoutATemporary(" + count + ")", () => fibonacciWithoutATemporary(count));
}
for (const count of [10, 30, 31, 32, 33, 53, 54, 64, 1023, 1024]) attempt("doubled(" + count + ")", () => doubled(count));
for (const step of [1, 1073741823, 2147483647, 0.5, "1", 1n, null, undefined, -0]) attempt("pingPong(3, " + show(step) + ")", () => pingPong(3, step));
for (const [a, b] of [[5, 3], [2147483647, -1], [-2147483648, 1], [2147483647, -2147483648], [0, 0], [-2147483648, -2147483648]]) attempt("difference(" + a + ", " + b + ")", () => difference(a, b));
for (const count of [10, 65536, 65537, 92682]) attempt("triangle(" + count + ")", () => triangle(count));
for (const value of [1, "1", 1.5, -0, 2147483648, undefined, null, 1n, NaN, [1]]) attempt("copied(" + show(value) + ")", () => copied(value));
