function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

function replacedThroughArguments(n, replacement) {
  const before = n + 1;
  arguments[0] = replacement;
  return [before, n, n + 1, n | 0, typeof n, arguments[0]];
}

function parameterDoesNotChangeArguments(n) {
  n++;
  return [arguments[0], n, arguments.length];
}

function replacedByAHelper(n, replacement) {
  overwriteFirst(arguments, replacement);
  return [n, n * 2, n & 7, arguments[0]];
}

function overwriteFirst(list, value) {
  list[0] = value;
}

function sumOfArguments() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i];
  return total;
}

function sumOfRest(...values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

for (let i = 0; i < 2000; i++) {
  replacedThroughArguments(i, i + 1);
  parameterDoesNotChangeArguments(i);
  replacedByAHelper(i, i + 1);
  sumOfArguments(i, 1, 2);
  sumOfRest(i, 1, 2);
}

for (const value of [5, "5", 5.5, -0, null, undefined, 5n, NaN, 2147483648, [5]]) {
  attempt("replacedThroughArguments(1, " + show(value) + ")", () => replacedThroughArguments(1, value));
  attempt("replacedByAHelper(1, " + show(value) + ")", () => replacedByAHelper(1, value));
  attempt("parameterDoesNotChangeArguments(" + show(value) + ")", () => parameterDoesNotChangeArguments(value));
  attempt("sumOfArguments(1, " + show(value) + ", 1)", () => sumOfArguments(1, value, 1));
  attempt("sumOfRest(1, " + show(value) + ", 1)", () => sumOfRest(1, value, 1));
}
