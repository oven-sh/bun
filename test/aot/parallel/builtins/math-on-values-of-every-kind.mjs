// A function of Math makes a number of each argument, from the first to the last, whatever it is handed: the conversions stand in front of its code in line.
const log = [];
const noisy = (name, value) => ({ valueOf() { log.push(name); return value; } });
function attempt(f) { try { return String(f()); } catch (error) { return error.name + ": " + error.message; } }
function max2(a, b) { return Math.max(a, b); }
function min3(a, b, c) { return Math.min(a, b, c); }
function floor(x) { return Math.floor(x); }
function abs(x) { return Math.abs(x); }
function pow(a, b) { return Math.pow(a, b); }
function imul(a, b) { return Math.imul(a, b); }
function atan2(a, b) { return Math.atan2(a, b); }
function hypot(a, b) { return Math.hypot(a, b); }
function round(x) { return Math.round(x); }
function sign(x) { return Math.sign(x); }
function extra(a, b) { return Math.abs(a, b); }
const values = [1, -2.5, 0, -0, NaN, Infinity, "3", "x", "", null, undefined, true, [], [4], {}, 2 ** 31, -(2 ** 31) - 1];
for (const a of values) console.log([max2(a, 1), min3(a, 1, -1), floor(a), abs(a), pow(a, 2), imul(a, 3), atan2(a, 1), hypot(a, 1), round(a), sign(a)].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" "));
console.log(attempt(() => max2(noisy("a", 1), noisy("b", 2))), attempt(() => min3(noisy("c", 1), noisy("d", NaN), noisy("e", 3))), attempt(() => pow(noisy("f", 2), noisy("g", 3))), attempt(() => extra(noisy("h", -1), noisy("i", 2))), log.join());
console.log(attempt(() => max2(Symbol("s"), noisy("never", 1))), attempt(() => max2(noisy("first", 1), Symbol("s"))), attempt(() => floor(10n)), attempt(() => abs({ valueOf() { throw new RangeError("no"); } })), log.join());
console.log(attempt(() => Math.max()), attempt(() => Math.min()), attempt(() => Math.max(1)), attempt(() => Math.hypot()), attempt(() => Math.floor()));
