// A loop calls a function that it was handed, the same one in every turn, and nobody knows at build time which of a few it is.
// The loop asks once, in front of its first turn, and stands in the function once more for each of them, with that function in line. Whatever else the value is goes through the loop as it was.
// A list that is never built is read under a key that names no element, and a sum of fractions that waits past calls behind its loop stays in a register in the loop.
// IR= 5 totalOf = TypeTest v[0-9]+ testedType=f[0-9]+
// IR= 0 underFlag ElemGet
// IR= 0 underNothing ElemGet
function byIndex(i, ...rest) { return rest[i]; }
function byBoolean(a, ...rest) { const k = a === 1; return rest[k] === undefined ? 1 : 0; }
function byNothing(a, ...rest) { return (rest[null] === undefined ? 1 : 0) + (rest[undefined] === undefined ? 2 : 0); }
function sumOfAll(...rest) { let t = 0; for (let i = 0; i < rest.length; i++) t += rest[i]; return t; }
function lastOf(...rest) { return rest[rest.length - 1]; }
const few = { byIndex, byBoolean, byNothing, sumOfAll, lastOf };
const unknown = value => JSON.parse(JSON.stringify(value));
function totalOf(name, turns) { const f = few[unknown(name)]; let t = 0; for (let i = 0; i < turns; i++) t += f(i & 3, 1, 2, 3, 4); return t; }
// Reached by value, so that each stays a function of its own.
const kept = { totalOf, underFlag, underNothing };
for (const name of [...Object.keys(few), "hasOwnProperty", "toString", "valueOf", "constructor", "missing"]) {
  for (const turns of [0, 1, 2, 5, 1000]) {
    try {
      console.log(name, turns, String(kept[unknown("totalOf")](name, turns)).slice(0, 60));
    } catch (error) {
      console.log(name, turns, error.constructor.name, error.message);
    }
  }
}

// What comes back is no int32: a fraction, a number beyond int32, -0, NaN, undefined, a text, a bigint, an object.
function quarter(i) { return i / 4; }
function large(i) { return i * 1e9 + 2147483647; }
function minusZero() { return -0; }
function sometimesNaN(i) { return i === 2 ? NaN : i; }
function sometimesNothing(i) { if (i !== 3) return i; }
function sometimesText(i) { return i === 2 ? "x" : i; }
function big(i) { return BigInt(i); }
function boxed(i) { return { valueOf() { return i * 2; } }; }
const kinds = { quarter, large, minusZero, sometimesNaN, sometimesNothing, sometimesText, big, boxed };
function sumFrom(start, f, turns) { let t = start; for (let i = 0; i < turns; i++) t += f(i & 3); return t; }
for (const name of Object.keys(kinds)) {
  for (const start of [0, 0.5, -0, 2147483647, "", 10n]) {
    try {
      const t = sumFrom(start, kinds[unknown(name)], 9);
      console.log(name, typeof start, Object.is(t, -0) ? "-0" : String(t));
    } catch (error) {
      console.log(name, typeof start, error.constructor.name, error.message);
    }
  }
}

// The function sees how it was called: no receiver, no new.target, its own arguments, itself, its captures, and a stack with its name on it.
function looksAround(a) { "use strict"; return (this === undefined ? 1 : 0) + (new.target === undefined ? 2 : 0) + arguments.length * 4 + (arguments[1] === "second" ? 100 : 0) + a; }
function sloppy() { return this === globalThis ? 1 : 0; }
function namesItself(a) { return namesItself.name.length + namesItself.length + a; }
const counter = (() => { let calls = 0; return step => (calls += step); })();
const other = (() => { let calls = 100; return step => (calls -= step); })();
function whereAmI(a) { return a === 2 ? new Error("here").stack.split("\n").slice(1, 3).map(line => line.trim().split(" ")[1]).join("<") : ""; }
const lookers = { looksAround, sloppy, namesItself, counter, other, whereAmI };
function joined(f, turns) { let t = ""; for (let i = 0; i < turns; i++) t += f(i, "second") + ","; return t; }
for (const name of Object.keys(lookers)) console.log(name, joined(lookers[unknown(name)], 4));

// The function throws in the middle, changes the table that it came from, or comes back into the loop that calls it.
function throwsAtThree(i) { if (i === 3) throw new RangeError("three"); return i; }
function swapsTheTable(i) { swapped.swapsTheTable = throwsAtThree; return i * 10; }
function callsTheLoopAgain(i) { return i === 1 ? counted(swapped[unknown("throwsAtThree")], 3) : i; }
const swapped = { throwsAtThree, swapsTheTable, callsTheLoopAgain };
function counted(f, turns) { let t = 0, done = 0; try { for (let i = 0; i < turns; i++) { t += f(i); done++; } } catch (error) { return error.message + " after " + done + " with " + t; } return t; }
for (const name of ["throwsAtThree", "swapsTheTable", "callsTheLoopAgain", "swapsTheTable"]) console.log(name, counted(swapped[unknown(name)], 6));

// The value changes from turn to turn, or is one of more functions than a loop is copied for: the loop stays as it is, and gives the same.
function everyTurnAnother(names, turns) { let t = 0; for (let i = 0; i < turns; i++) t += few[names[i % names.length]](i & 3, 1, 2, 3, 4); return t; }
console.log(everyTurnAnother(unknown(Object.keys(few)), 23));
const many = {};
for (let n = 0; n < 12; n++) many["f" + n] = [a => a, a => a + 1, a => a * 2, a => a - 1, a => -a, a => a | 1, a => a & 1, a => a ^ 3, a => a >> 1, a => a << 1, a => a % 3, a => a / 2][n];
function ofMany(f, turns) { let t = 0; for (let i = 0; i < turns; i++) t += f(i); return t; }
for (const name of Object.keys(many)) console.log(name, ofMany(many[unknown(name)], 10));

// A list that is not built, read under a key that names no element.
function underFlag(n, a, b) { return [a, b][n > 1]; }
function underNothing(a, b) { return String([a, b][undefined]) + [a, b][null]; }
function underFlagOrName(key, a, b) { return [a, b][key]; }
console.log(kept[unknown("underFlag")](unknown(2), 1, 2), kept[unknown("underFlag")](unknown(0), 1, 2), kept[unknown("underNothing")](1, 2), underFlagOrName(unknown("length"), 1, 2), underFlagOrName(unknown(true), 1, 2), underFlagOrName(unknown(1), 1, 2));

// Sums of fractions that wait past calls: behind the loop, in front of it, between two loops, on a rare way in the loop, and more of them than there are registers.
const told = [];
function tell(value) { told.push(unknown(value)); return told.length; }
function waitsBehind(turns, step) {
  let sum = 0.5;
  for (let i = 0; i < turns; i++) sum += step;
  tell(1); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  return sum;
}
function waitsInFront(turns, step) {
  let sum = step * 3;
  tell(1); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  for (let i = 0; i < turns; i++) sum += step;
  return sum;
}
function waitsBetween(turns, step) {
  let sum = 0.25;
  for (let i = 0; i < turns; i++) sum += step;
  tell(sum); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  for (let i = 0; i < turns; i++) sum *= step;
  tell(1); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(sum);
  return sum;
}
function tellsNowAndThen(turns, step) {
  let sum = 0.125;
  for (let i = 0; i < turns; i++) { sum += step; if (sum > 40 && sum < 41) tell(sum); }
  tell(1); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  return sum;
}
function leavesEarly(turns, step) {
  let sum = 0.5;
  for (let i = 0; i < turns; i++) { sum += step; if (sum > 10) { tell(sum); tell(i); return sum - 1; } }
  tell(1); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  return sum;
}
function manySums(turns, s) {
  let a = 0.5, b = 1.5, c = 2.5, d = 3.5, e = 4.5, f = 5.5, g = 6.5, h = 7.5, k = 8.5, l = 9.5, m = 10.5, n = 11.5, o = 12.5, p = 13.5, q = 14.5, r = 15.5, u = 16.5, v = 17.5;
  for (let i = 0; i < turns; i++) { a += s; b += a; c += s * 2; d += c; e -= s; f += e; g += s / 2; h += g; k += s; l += k; m -= s; n += m; o += s; p += o; q += s; r += q; u += s; v += u; }
  tell(1); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  return [a, b, c, d, e, f, g, h, k, l, m, n, o, p, q, r, u, v].join(" ");
}
function caught(turns, step) {
  let sum = 0.5;
  try {
    for (let i = 0; i < turns; i++) { sum += step; if (i === 7) throwsAtThree(3); }
  } catch (error) {
    tell(error.message); tell(2); tell(3); tell(4); tell(5); tell(6); tell(7); tell(8);
  }
  return sum;
}
for (const f of [waitsBehind, waitsInFront, waitsBetween, tellsNowAndThen, leavesEarly, manySums, caught]) {
  for (const turns of [0, 1, 3, 100]) console.log(f.name, turns, f(unknown(turns), unknown(1.25)), told.splice(0).join(" "));
}
