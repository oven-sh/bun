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
  var before = n + 1;
  arguments[0] = replacement;
  return [before, n, n + 1, n | 0, typeof n];
}

function parameterChangesArguments(n) {
  n++;
  return [arguments[0], n, arguments.length];
}

function replacedByAHelper(n, replacement) {
  overwriteFirst(arguments, replacement);
  return [n, n * 2, n & 7];
}

function overwriteFirst(list, value) {
  list[0] = value;
}

function replacedInALoop(n, replacement) {
  var seen = [];
  for (var i = 0; i < 4; i++) {
    seen.push(n + i);
    if (i === 1) arguments[0] = replacement;
  }
  return seen;
}

function missingArgumentIsNotAliased(n) {
  arguments[0] = "stored";
  return [n, arguments[0], arguments.length];
}

function aliasEndsAfterDelete(n) {
  delete arguments[0];
  arguments[0] = "stored";
  return [n, n + 1, arguments[0]];
}

function aliasEndsAfterDefine(n) {
  Object.defineProperty(arguments, "0", { writable: false });
  n = 9;
  return [n, arguments[0]];
}

function defaultsTurnAliasingOff(n, unused = 0) {
  arguments[0] = "stored";
  return [n, n + 1];
}

function sumOfArguments() {
  var total = 0;
  for (var i = 0; i < arguments.length; i++) total += arguments[i];
  return total;
}

for (var i = 0; i < 2000; i++) {
  replacedThroughArguments(i, i + 1);
  parameterChangesArguments(i);
  replacedByAHelper(i, i + 1);
  replacedInALoop(i, i + 1);
  sumOfArguments(i, 1, 2);
}

var replacements = [5, "5", 5.5, -0, null, undefined, 5n, NaN, 2147483648, [5]];
replacements.forEach(function (value) {
  attempt("replacedThroughArguments(1, " + show(value) + ")", function () { return replacedThroughArguments(1, value); });
  attempt("replacedByAHelper(1, " + show(value) + ")", function () { return replacedByAHelper(1, value); });
  attempt("replacedInALoop(1, " + show(value) + ")", function () { return replacedInALoop(1, value); });
  attempt("parameterChangesArguments(" + show(value) + ")", function () { return parameterChangesArguments(value); });
  attempt("sumOfArguments(1, " + show(value) + ", 1)", function () { return sumOfArguments(1, value, 1); });
});
attempt("missingArgumentIsNotAliased()", function () { return missingArgumentIsNotAliased(); });
attempt("aliasEndsAfterDelete(1)", function () { return aliasEndsAfterDelete(1); });
attempt("aliasEndsAfterDefine(1)", function () { return aliasEndsAfterDefine(1); });
attempt("defaultsTurnAliasingOff(1)", function () { return defaultsTurnAliasingOff(1); });
