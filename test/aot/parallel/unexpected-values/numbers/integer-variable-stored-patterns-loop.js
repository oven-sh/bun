// An integer variable is stored to by patterns and loop heads.
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

const letters = ["a", "b", "c", "d"];

function report(index) {
  return [index, typeof index, letters[index]];
}

function arrayPattern(source) {
  let index = 0;
  [index] = source;
  return [report(index), letters[index], index | 0, index + 1];
}

function objectPattern(source) {
  let index = 0;
  ({ index } = source);
  return [report(index), letters[index], index | 0, index + 1];
}

function renamedInAnObjectPattern(source) {
  let index = 0;
  ({ at: index } = source);
  return [letters[index], index & 3, index + 1];
}

function patternWithADefault(source) {
  let index = 0;
  [index = 1.5] = source;
  return [letters[index], index | 0, index + 1];
}

function restPattern(source) {
  let index = 0;
  [...index] = source;
  return [letters[index], index | 0, index + 1];
}

function nestedPattern(source) {
  let index = 0;
  [[index]] = source;
  return [letters[index], index | 0, index + 1];
}

function forOf(source) {
  let index = 0;
  const seen = [];
  for (index of source) seen.push(letters[index], index | 0, index + 1);
  seen.push(index);
  return seen;
}

function forIn(source) {
  let index = 0;
  const seen = [];
  for (index in source) seen.push(letters[index], index | 0, index + 1);
  seen.push(index);
  return seen;
}

function swapped(a, b) {
  let low = 0;
  let high = 1;
  low = a | 0;
  high = b;
  [low, high] = [high, low];
  return [letters[low], letters[high], low + 1, high + 1];
}

for (const round of ["cold", "warm"]) {
  for (const value of [2, "2", 1.5, -0, undefined, null, 2n, NaN, 2147483648, [1], { valueOf: () => 3 }]) {
    const label = round + " " + show(value);
    attempt(label + " arrayPattern", () => arrayPattern([value]));
    attempt(label + " objectPattern", () => objectPattern({ index: value }));
    attempt(label + " renamedInAnObjectPattern", () => renamedInAnObjectPattern({ at: value }));
    attempt(label + " patternWithADefault", () => patternWithADefault([value]));
    attempt(label + " restPattern", () => restPattern([value]));
    attempt(label + " nestedPattern", () => nestedPattern([[value]]));
    attempt(label + " forOf", () => forOf([1, value]));
    attempt(label + " swapped", () => swapped(1, value));
  }
  attempt(round + " forIn over an array", () => forIn(["x", "y"]));
  attempt(round + " forIn over an object", () => forIn({ 1: "x", b: "y" }));
  attempt(round + " forIn over a string", () => forIn("xy"));
  attempt(round + " forOf over a string", () => forOf("12"));
  attempt(round + " arrayPattern of a string", () => arrayPattern("2"));
  for (let i = 0; i < 1000; i++) {
    arrayPattern([i & 3]);
    objectPattern({ index: i & 3 });
    forOf([i & 3]);
    swapped(i & 3, i & 1);
  }
}
