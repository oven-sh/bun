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

function add(a, b) {
  return a + b;
}

function scale(value, factor) {
  return value * factor;
}

function bucket(value) {
  return value & 15;
}

function next(value) {
  return value + 1;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function average(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total / list.length;
}

function power(base, exponent) {
  if (exponent === 0) return 1;
  return base * power(base, exponent - 1);
}

function digits(value) {
  let count = 0;
  try {
    do {
      count++;
      value = (value / 10) | 0;
    } while (value > 0);
  } finally {
    count += 0;
  }
  return count;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + clamp(i, 0, 10) + average([i, i]) + power(2, i & 7) + digits(i);
console.log("the honest total", total);

const calls = [
  "add('1', 2)",
  "add(1, '2')",
  "add(1)",
  "add(1n, 2n)",
  "add(1n, 2)",
  "add(2147483647, 1)",
  "add(0.1, 0.2)",
  "scale('3', '4')",
  "scale(0, -1)",
  "scale(65536, 65536)",
  "scale(3)",
  "bucket('300')",
  "bucket(300.9)",
  "bucket(4294967297)",
  "bucket(300n)",
  "next('41')",
  "next(2147483647)",
  "next()",
  "next({ valueOf() { return 1; } })",
  "clamp('5', 0, 3)",
  "clamp(NaN, 0, 3)",
  "clamp(-0, 0, 3)",
  "average(['1', '2'])",
  "average('12')",
  "power('3', 2)",
  "power(2, 31)",
  "digits('12345')",
  "digits(4294967296)",
  "add(1, 2)",
];

for (const call of calls) attempt("direct eval " + call, () => eval(call));

const handed = new Function("add", "scale", "bucket", "next", "clamp", "average", "power", "digits", "call", "return eval(call);");
for (const call of calls) attempt("new Function " + call, () => handed(add, scale, bucket, next, clamp, average, power, digits, call));

globalThis.sharedNext = next;
globalThis.sharedAdd = add;
attempt("indirect eval through a global", () => (0, eval)("[sharedNext('41'), sharedAdd('1', 2), sharedNext(41), sharedAdd(1.5, 2)]"));

attempt("honest plain calls afterwards", () => [add(1, 2), scale(3, 4), bucket(300), next(41), clamp(5, 0, 3), average([1, 2, 3]), power(3, 4), digits(12345)]);
