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

function counter() {
  let next = 0;
  return { valueOf: () => ++next };
}

function alternating() {
  let calls = 0;
  const results = [1, "2", 3.5, true, null, 4n];
  return { valueOf: () => results[calls++ % results.length] };
}

function minusItself(value) {
  return value - value;
}

function timesItself(value) {
  return value * value;
}

function lessThanItself(value) {
  return [value < value, value > value, value <= value, value >= value];
}

function equalToItself(value) {
  return [value == value, value === value, value == 1, value == 2];
}

function truncatedTwice(value) {
  return [value | 0, value | 0, ~value, value >>> 0];
}

function incremented(value) {
  const before = value++;
  return [before, value];
}

function addedToItself(value) {
  value += value;
  return value;
}

function usedAsAnIndexTwice(value) {
  const list = ["a", "b", "c", "d", "e"];
  return [list[+value], list[+value], list[value | 0]];
}

function usedAsABound(value) {
  const seen = [];
  for (let i = 0; i < value; i += 2) seen.push(i);
  return seen;
}

function clamped(value) {
  return value < 2 ? 2 : value > 3 ? 3 : +value;
}

function summed(value) {
  let total = 0;
  for (let i = 0; i < 5; i++) total += +value;
  return total;
}

const uses = [minusItself, timesItself, lessThanItself, equalToItself, truncatedTwice, incremented, addedToItself, usedAsAnIndexTwice, usedAsABound, clamped, summed];
for (const use of uses) attempt(use.name + " of a counter", () => use(counter()));
for (const use of uses) attempt(use.name + " of an alternating value", () => use(alternating()));
for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 5);
for (const use of uses) attempt(use.name + " of a counter after 2000 numbers", () => use(counter()));
for (const use of uses) attempt(use.name + " of an alternating value after 2000 numbers", () => use(alternating()));
for (const use of uses) attempt(use.name + " of 3", () => use(3));
