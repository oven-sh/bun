// a part of the growth is an object: its conversion runs code of the program, in the order of the parts, with the hint of the operator, and may throw in the middle of a growth
let log = "";
const byToString = { toString() { log += "s"; return "S"; } };
const byValueOf = { valueOf() { log += "v"; return 7; }, toString() { log += "x"; return "never"; } };
const byBoth = { [Symbol.toPrimitive](hint: string) { log += "[" + hint + "]"; return hint; } };
const thrower = { toString() { log += "t"; throw new RangeError("no text"); } };
function added(part: unknown, n: number) { let s = ""; for (let i = 0; i < n; i++) s += "a" + i + part; return s; }
function templated(part: unknown, n: number) { let s = ""; for (let i = 0; i < n; i++) s += `b${i}${part}`; return s; }
function direct(part: any, n: number) { let s = "<"; for (let i = 0; i < n; i++) s += part; return s; }
function twoParts(one: any, two: any, n: number) { let s = ""; for (let i = 0; i < n; i++) s = s + one + two; return s; }
function tell(f: () => unknown) { log = ""; try { return f() + " " + log; } catch (e) { return (e as Error).name + " " + log; } }
console.log(tell(() => added(byToString, 2)), tell(() => added(byValueOf, 2)), tell(() => added(byBoth, 2)));
console.log(tell(() => templated(byToString, 2)), tell(() => templated(byValueOf, 2)), tell(() => templated(byBoth, 2)));
console.log(tell(() => direct(byToString, 2)), tell(() => direct(byValueOf, 2)), tell(() => direct(byBoth, 2)));
console.log(tell(() => twoParts(byValueOf, byToString, 2)), tell(() => twoParts(byToString, thrower, 2)), tell(() => twoParts(thrower, byToString, 2)));
console.log(tell(() => added("plain", 3)), tell(() => direct(4, 3)), tell(() => twoParts(1, 2, 2)));
