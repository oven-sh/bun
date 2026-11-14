// Arithmetic and comparisons of strings with numbers, with the other primitives and with each other, in loops.
const strings = ["1", "22", "3.5", "-4", "0.125", "1e3", "0x1f", "77.25", "", " 12 ", "abc", "-0", "00012", "999999999999999", "9007199254740993", "1234567", "Infinity", "-", "+7", "٣", " 5", "12px", "0b101", "1_000", "5" + String(strings => 1).length, "12345678901234567890"];
const ropes = strings.map((s, i) => s.slice(0, 1) + [s.slice(1)].join("") + (i & 1 ? "" : "0"));
const others = [0, -0, 1, 2.5, -3, 1e21, NaN, Infinity, true, false, null, undefined, 2147483647, -2147483648];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "number" ? String(v) : typeof v + v;
function byConstant(list) { let s = ""; for (let k = 0; k < list.length; k++) { const x = list[k]; s += show(x * 2) + " " + show(x - 1) + " " + show(x / 4) + " " + show(7 - x) + " " + show(3 * x) + " " + show(100 / x) + " " + show(x % 5) + " " + (x > 3) + (x < 3) + (x >= 22) + (x <= 22) + (3 > x) + (3 < x) + (22 >= x) + (22 <= x) + ";"; } return s; }
function byValue(list, others) { let s = ""; for (const x of list) for (const y of others) s += show(x * y) + show(x - y) + show(x / y) + show(x % y) + show(y * x) + show(y - x) + show(y / x) + show(y % x) + (x < y) + (x > y) + (x <= y) + (x >= y) + (y < x) + (y > x) + (y <= x) + (y >= x) + "\n"; return s; }
function hash(s) { let h = 0; for (let k = 0; k < s.length; k++) h = h * 31 + s.charCodeAt(k) | 0; return h; }
console.log(byConstant(strings)); console.log(byConstant(ropes));
for (const [a, b] of [[strings, others], [ropes, others], [strings, strings], [others, others], [strings, ropes]]) { const s = byValue(a, b); console.log(s.length, hash(s), s.slice(0, 200)); }
function refused(f) { try { return show(f()); } catch (error) { return error.name; } }
const mixed = ["5", Symbol("s"), 5n, { valueOf() { return "6"; } }, new Date(7), new String("8"), [9], () => 1, "10"];
for (const x of mixed) for (const y of mixed) console.log([refused(() => x * y), refused(() => x - y), refused(() => x / y), refused(() => x < y), refused(() => x >= y), refused(() => y * 2), refused(() => 2 - y), refused(() => y > 5)].join());
function long(turns) { let n = 0; for (let k = 0; k < turns; k++) { const x = strings[k % 8]; n += (x * 2 || 0) + (x > 3 ? 1 : 0) + (5 - x || 0); } return n; }
console.log(long(8), long(4000));
