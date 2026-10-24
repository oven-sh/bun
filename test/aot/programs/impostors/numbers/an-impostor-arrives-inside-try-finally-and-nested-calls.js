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

function triple(value) {
  log.push("triple");
  return value * 3;
}

function low(value) {
  log.push("low");
  return value & 3;
}

function insideTry(value) {
  let stage = 0;
  try {
    stage = 1;
    const result = triple(value) + low(value);
    stage = 2;
    return [result, stage];
  } catch (error) {
    log.push("catch at stage " + stage);
    return [error.constructor.name, stage];
  } finally {
    log.push("finally at stage " + stage);
  }
}

function finallyOverrides(value) {
  let n = 0;
  try {
    n = value + 1;
    return n;
  } finally {
    n++;
    log.push("finally " + show(n));
  }
}

function nestedTries(value) {
  const trail = [];
  try {
    trail.push("outer");
    try {
      trail.push("inner");
      trail.push(value - 1);
      trail.push(-value);
    } finally {
      trail.push("inner finally");
    }
    trail.push("between");
  } catch (error) {
    trail.push("caught " + error.constructor.name);
  } finally {
    trail.push("outer finally");
  }
  return trail;
}

function throwsItsArithmetic(value) {
  try {
    throw value * 2;
  } catch (thrown) {
    if (thrown instanceof Error) return thrown.constructor.name;
    return [thrown, thrown + 1];
  }
}

function loopWithTry(list) {
  let total = 0;
  let failures = 0;
  for (let i = 0; i < list.length; i++) {
    try {
      total += list[i] * 1;
    } catch {
      failures++;
      continue;
    } finally {
      total += 100;
    }
    total += 1000;
  }
  return [total, failures];
}

function recursion(value, depth) {
  if (depth === 0) return value | 0;
  return recursion(value, depth - 1) + depth;
}

function chain(value) {
  return triple(low(triple(value)));
}

function argumentsAreEvaluatedFirst(value) {
  const order = [];
  const take = (a, b, c) => [a, b, c];
  const result = take((order.push("a"), value + 1), (order.push("b"), value * 2), (order.push("c"), ~value));
  return [result, order];
}

const uses = [insideTry, finallyOverrides, nestedTries, throwsItsArithmetic, chain, argumentsAreEvaluatedFirst];
for (let i = 0; i < 2000; i++) {
  for (const use of uses) use(i);
  loopWithTry([1, 2, 3]);
  recursion(i, 5);
}

const impostors = ["5", "x", 0.5, -0, null, undefined, 5n, NaN, 2147483647, [5], Symbol("s"), Object.create(null), { valueOf: () => 5 }, { valueOf() { throw new RangeError("no"); } }];
for (const value of impostors) {
  for (const use of uses) {
    log.length = 0;
    const result = outcome(() => use(value));
    console.log(use.name, "of", outcome(() => value), "->", result, "|", log.join(", "));
  }
  attempt("loopWithTry with " + outcome(() => value), () => loopWithTry([1, value, 3]));
  attempt("recursion of " + outcome(() => value), () => recursion(value, 5));
}
