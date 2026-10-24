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

function becomesAText() {
  let value = 0;
  const before = value + 1;
  value = "abc";
  return [before, value + 1, value * 2, value | 0, typeof value, value.length];
}

function becomesANumericText() {
  let value = 1;
  value = "2";
  return [value + 1, value * 2, value | 0, value < 10, value === 2, value == 2];
}

function becomesUndefined() {
  let value = 1;
  value = undefined;
  return [value + 1, value | 0, value === undefined, typeof value];
}

function becomesNull() {
  let value = 1;
  value = null;
  return [value + 1, value | 0, value === null, typeof value];
}

function becomesAnObject() {
  let value = 1;
  value = { valueOf: () => 41, extra: "member" };
  return [value + 1, value * 2, value.extra, typeof value];
}

function becomesAnArray() {
  let value = 1;
  value = [4];
  return [value + 1, value * 2, value.length, Array.isArray(value)];
}

function becomesABigInt() {
  let value = 1;
  value = 4n;
  return [value + 1n, value * 2n, typeof value, outcome(() => value + 1)];
}

function becomesABoolean() {
  let value = 1;
  value = true;
  return [value + 1, value === true, typeof value];
}

function becomesAFunction() {
  let value = 1;
  value = () => 7;
  return [value(), typeof value, typeof (value + 1)];
}

function changesInALoop() {
  let value = 0;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(value + 1);
    value = i % 3 === 0 ? "t" : i % 3 === 1 ? 1.5 : i;
  }
  return seen;
}

function changesInOneBranch(flag) {
  let value = 0;
  if (flag) value = "text";
  return [value + 1, value | 0, typeof value];
}

function accumulatesTexts(parts) {
  let result = 0;
  for (let i = 0; i < parts.length; i++) result += parts[i];
  return result;
}

var atTheTop = 0;
function storesAtTheTop(value) {
  atTheTop = value;
}
function readsTheTop() {
  return [atTheTop + 1, atTheTop | 0, typeof atTheTop];
}

const uses = [becomesAText, becomesANumericText, becomesUndefined, becomesNull, becomesAnObject, becomesAnArray, becomesABigInt, becomesABoolean, becomesAFunction, changesInALoop];
for (const round of ["first", "second"]) for (const use of uses) attempt(round + " " + use.name, use);
for (let i = 0; i < 2000; i++) changesInOneBranch(false);
attempt("changesInOneBranch(false)", () => changesInOneBranch(false));
attempt("changesInOneBranch(true)", () => changesInOneBranch(true));
attempt("accumulatesTexts of numbers", () => accumulatesTexts([1, 2, 3]));
attempt("accumulatesTexts of texts", () => accumulatesTexts(["a", "b"]));
attempt("accumulatesTexts of both", () => accumulatesTexts([1, 2, "a", 3, 4]));
for (const value of [5, "5", 5.5, undefined, null, 5n, [5]]) {
  storesAtTheTop(value);
  attempt("the variable at the top holds " + show(value), readsTheTop);
}
