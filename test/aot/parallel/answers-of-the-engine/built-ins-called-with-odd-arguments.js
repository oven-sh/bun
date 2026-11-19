// A call of a known built-in is typed by its rows whatever it is handed: objects whose valueOf throws, symbols, big integers, nothing at all. What is computed from the answer goes by that type, so each answer must be of it.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function attempt(way) { try { return way(); } catch (error) { return error.name; } }
function tell(value) { return typeof value === "symbol" ? "a symbol" : typeof value === "bigint" ? value.toString() + "n" : typeof value === "object" && value !== null ? "an object" : typeof value === "function" ? "a function" : value; }
const log = [];
const thrower = { valueOf() { throw new RangeError("asked for a number"); }, toString() { throw new RangeError("asked for a text"); } };
const teller = { valueOf() { log.push("valueOf"); return 3; }, toString() { log.push("toString"); return "4"; } };
const odd = [undefined, null, true, false, 0, -0, 1.5, NaN, "12", " 7 ", "x", "", 10n, Symbol("s"), {}, [], [5], [1, 2], thrower, teller, Math.abs];
function numberOf(value) { return Number(value); }
function numberPlusOne(value) { return Number(value) + 1; }
function remainderOfNumber(value) { let sum = 0; const divisor = Number(value); for (let i = 0; i < 5; i++) sum += i % divisor; return sum; }
function textOf(value) { return String(value); }
function lengthOfText(value) { return String(value).length; }
function truthOf(value) { return Boolean(value); }
function wholeOf(value) { return parseInt(value); }
function wholeInBase(value, base) { return parseInt(value, base); }
function fractionOf(value) { return parseFloat(value); }
function floorOf(value) { return Math.floor(value); }
function floorTimesTwo(value) { return Math.floor(value) * 2; }
function leastOf(a, b, c) { return Math.min(a, b, c); }
function greatestOf(a, b) { return Math.max(a, b); }
function magnitudeOf(value) { return Math.abs(value); }
function rootOf(value) { return Math.sqrt(value); }
function isList(value) { return Array.isArray(value); }
function written(value) { return JSON.stringify(value); }
function kindOfWritten(value) { return typeof JSON.stringify(value); }
function keysOf(value) { return Object.keys(value).join("|"); }
function isWhole(value) { return Number.isInteger(value); }
function isNoNumber(value) { return isNaN(value); }
function isStrictlyNoNumber(value) { return Number.isNaN(value); }
function fromCode(value) { return String.fromCharCode(value); }
const ways = [numberOf, numberPlusOne, remainderOfNumber, textOf, lengthOfText, truthOf, wholeOf, fractionOf, floorOf, floorTimesTwo, magnitudeOf, rootOf, isList, written, kindOfWritten, keysOf, isWhole, isNoNumber, isStrictlyNoNumber, fromCode];
for (let w = 0; w < ways.length; w++) { for (let v = 0; v < odd.length; v++) { report(tell(attempt(() => ways[w](odd[v])))); } }
for (let a = 0; a < odd.length; a++) { report(tell(attempt(() => leastOf(odd[a], 2, odd[(a + 1) % odd.length])))); }
for (let a = 0; a < odd.length; a++) { report(tell(attempt(() => greatestOf(1, odd[a])))); }
for (let a = 0; a < odd.length; a++) { report(tell(attempt(() => wholeInBase("11", odd[a])))); }
report(log.join());
report(Number());
report(String());
report(Boolean());
report(parseInt());
report(parseFloat());
report(Math.floor());
report(Math.min());
report(Math.max());
report(Math.abs());
report(Array.isArray());
report(JSON.stringify());
report(attempt(() => Object.keys()));
report(Number.isInteger());
report(isNaN());
report(String.fromCharCode());
report(String.fromCharCode(65, 66, 67));
report(Number("1", "2", "3"));
report(Math.floor(1.5, thrower));
report(attempt(() => Math.min(1, thrower, teller)));
report(attempt(() => Math.max(teller, teller, thrower)));
report(log.join());
report("end");
