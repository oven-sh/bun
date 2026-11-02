// Many built-in functions convert an operand in the same way. Each row hands one of them a value that needs no conversion, then an object whose conversion looks at the stack, then a symbol, which the conversion refuses. Every row prints the names that the stack trace lists: the built-in function's own name stands above its caller's.
const namesIn = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(line => /at (\S+)/.exec(line)?.[1])
    .filter(name => name && !name.includes("/") && !name.includes(":"))
    .join(" < ");
let seen = "";
const text = {
  toString() {
    seen = namesIn(new Error().stack);
    return "b";
  },
};
const number = {
  valueOf() {
    seen = namesIn(new Error().stack);
    return 1;
  },
};
function row(run, value) {
  seen = "";
  try {
    run(value);
  } catch (error) {
    seen = error.constructor.name + " | " + namesIn(error.stack);
  }
  console.log(run.name + ":", seen);
}

function keptIndexOf(o) {
  const result = "abc".indexOf(o);
  return result + 1;
}
function keptLastIndexOf(o) {
  const result = "abc".lastIndexOf(o);
  return result + 1;
}
function keptIncludes(o) {
  const result = "abc".includes(o);
  return !result;
}
function keptStartsWith(o) {
  const result = "abc".startsWith(o);
  return !result;
}
function keptEndsWith(o) {
  const result = "abc".endsWith(o);
  return !result;
}
function keptLocaleCompare(o) {
  const result = "abc".localeCompare(o);
  return result + 1;
}
function keptPadStart(o) {
  const result = "abc".padStart(5, o);
  return result + 1;
}
function keptPadEnd(o) {
  const result = "abc".padEnd(5, o);
  return result + 1;
}
function returnedIndexOf(o) {
  return "abc".indexOf(o);
}
function returnedLastIndexOf(o) {
  return "abc".lastIndexOf(o);
}
function returnedIncludes(o) {
  return "abc".includes(o);
}
function returnedStartsWith(o) {
  return "abc".startsWith(o);
}
function returnedEndsWith(o) {
  return "abc".endsWith(o);
}
function returnedLocaleCompare(o) {
  return "abc".localeCompare(o);
}
row(keptIndexOf, "b");
row(keptIndexOf, text);
row(keptIndexOf, Symbol());
row(keptLastIndexOf, "b");
row(keptLastIndexOf, text);
row(keptLastIndexOf, Symbol());
row(keptIncludes, "b");
row(keptIncludes, text);
row(keptIncludes, Symbol());
row(keptStartsWith, "b");
row(keptStartsWith, text);
row(keptStartsWith, Symbol());
row(keptEndsWith, "b");
row(keptEndsWith, text);
row(keptEndsWith, Symbol());
row(keptLocaleCompare, "b");
row(keptLocaleCompare, text);
row(keptLocaleCompare, Symbol());
row(keptPadStart, "b");
row(keptPadStart, text);
row(keptPadStart, Symbol());
row(keptPadEnd, "b");
row(keptPadEnd, text);
row(keptPadEnd, Symbol());
row(returnedIndexOf, "b");
row(returnedIndexOf, text);
row(returnedIndexOf, Symbol());
row(returnedLastIndexOf, "b");
row(returnedLastIndexOf, text);
row(returnedLastIndexOf, Symbol());
row(returnedIncludes, "b");
row(returnedIncludes, text);
row(returnedIncludes, Symbol());
row(returnedStartsWith, "b");
row(returnedStartsWith, text);
row(returnedStartsWith, Symbol());
row(returnedEndsWith, "b");
row(returnedEndsWith, text);
row(returnedEndsWith, Symbol());
row(returnedLocaleCompare, "b");
row(returnedLocaleCompare, text);
row(returnedLocaleCompare, Symbol());

function keptCharAt(o) {
  const result = "abc".charAt(o);
  return result + 1;
}
function keptCharCodeAt(o) {
  const result = "abc".charCodeAt(o);
  return result + 1;
}
function keptAt(o) {
  const result = "abc".at(o);
  return result + 1;
}
function keptSlice(o) {
  const result = "abc".slice(o);
  return result + 1;
}
function keptSubstring(o) {
  const result = "abc".substring(o);
  return result + 1;
}
function keptRepeat(o) {
  const result = "abc".repeat(o);
  return result + 1;
}
function keptFloor(o) {
  const result = Math.floor(o);
  return result + 1;
}
function keptAbs(o) {
  const result = Math.abs(o);
  return result + 1;
}
function keptSqrt(o) {
  const result = Math.sqrt(o);
  return result + 1;
}
function keptMax(o) {
  const result = Math.max(o, 2);
  return result + 1;
}
function keptMin(o) {
  const result = Math.min(o, 2);
  return result + 1;
}
function returnedCharAt(o) {
  return "abc".charAt(o);
}
function returnedSlice(o) {
  return "abc".slice(o);
}
function returnedFloor(o) {
  return Math.floor(o);
}
function returnedAbs(o) {
  return Math.abs(o);
}
function returnedMax(o) {
  return Math.max(o, 2);
}
function returnedMin(o) {
  return Math.min(o, 2);
}
row(keptCharAt, 1);
row(keptCharAt, number);
row(keptCharAt, Symbol());
row(keptCharCodeAt, 1);
row(keptCharCodeAt, number);
row(keptCharCodeAt, Symbol());
row(keptAt, 1);
row(keptAt, number);
row(keptAt, Symbol());
row(keptSlice, 1);
row(keptSlice, number);
row(keptSlice, Symbol());
row(keptSubstring, 1);
row(keptSubstring, number);
row(keptSubstring, Symbol());
row(keptRepeat, 1);
row(keptRepeat, number);
row(keptRepeat, Symbol());
row(keptFloor, 1);
row(keptFloor, number);
row(keptFloor, Symbol());
row(keptAbs, 1);
row(keptAbs, number);
row(keptAbs, Symbol());
row(keptSqrt, 1);
row(keptSqrt, number);
row(keptSqrt, Symbol());
row(keptMax, 1);
row(keptMax, number);
row(keptMax, Symbol());
row(keptMin, 1);
row(keptMin, number);
row(keptMin, Symbol());
row(returnedCharAt, 1);
row(returnedCharAt, number);
row(returnedCharAt, Symbol());
row(returnedSlice, 1);
row(returnedSlice, number);
row(returnedSlice, Symbol());
row(returnedFloor, 1);
row(returnedFloor, number);
row(returnedFloor, Symbol());
row(returnedAbs, 1);
row(returnedAbs, number);
row(returnedAbs, Symbol());
row(returnedMax, 1);
row(returnedMax, number);
row(returnedMax, Symbol());
row(returnedMin, 1);
row(returnedMin, number);
row(returnedMin, Symbol());
