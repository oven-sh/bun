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

const toolbox = { add, scale, next, nested: { bucket } };
const pipeline = [next, bucket, value => scale(value, 2)];

function applyTwice(operation, value) {
  return operation(operation(value));
}

function runPipeline(value) {
  for (let i = 0; i < pipeline.length; i++) value = pipeline[i](value);
  return value;
}

function compose(first, second) {
  return value => second(first(value));
}

class Calculator {
  constructor(operation) {
    this.operation = operation;
  }
  run(a, b) {
    return this.operation(a, b);
  }
}

const adder = new Calculator(add);
const scaler = new Calculator(scale);
const nextBucket = compose(next, bucket);

let total = 0;
for (let i = 0; i < 2000; i++) total += toolbox.add(i, 1) + toolbox.scale(i, 2) + toolbox.next(i) + toolbox.nested.bucket(i) + applyTwice(next, i) + runPipeline(i) + adder.run(i, 1) + scaler.run(i, 2) + nextBucket(i);
console.log("the honest total", total);

const impostors = ["5", "", "abc", 1.5, -0, null, undefined, true, 5n, NaN, 2147483647, 4294967297, [5], { valueOf: () => 5 }, Symbol("s")];
for (const value of impostors) {
  const label = show(value);
  attempt("toolbox.add(" + label + ", 1)", () => toolbox.add(value, 1));
  attempt("toolbox.scale(" + label + ", 2)", () => toolbox.scale(value, 2));
  attempt("toolbox.next(" + label + ")", () => toolbox.next(value));
  attempt("toolbox.nested.bucket(" + label + ")", () => toolbox.nested.bucket(value));
  attempt("applyTwice(next, " + label + ")", () => applyTwice(next, value));
  attempt("applyTwice(bucket, " + label + ")", () => applyTwice(bucket, value));
  attempt("runPipeline(" + label + ")", () => runPipeline(value));
  attempt("adder.run(" + label + ", 1)", () => adder.run(value, 1));
  attempt("scaler.run(" + label + ", 2)", () => scaler.run(value, 2));
  attempt("nextBucket(" + label + ")", () => nextBucket(value));
}

toolbox.next = value => value + "!";
pipeline[0] = value => value + 0.5;
adder.operation = scale;
attempt("the field holds another function", () => [toolbox.next(1), runPipeline(1), adder.run(3, 4)]);
attempt("honest calls afterwards", () => [toolbox.add(1, 2), toolbox.scale(3, 4), applyTwice(next, 1), scaler.run(3, 4), nextBucket(30)]);
