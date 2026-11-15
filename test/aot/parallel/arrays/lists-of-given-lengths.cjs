// new Array(given), where the build does not know what is given: the site remembers what its lists became.
const lines = [];
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (Array.isArray(v) ? "[" + v.length + "]" : "{" + Object.keys(v) + "}") : typeof v === "symbol" ? "symbol" : String(v); }
function show(a) { if (!Array.isArray(a)) return one(a); let s = a.length + ":"; for (let i = 0; i < a.length && i < 8; i++) s += (i in a ? one(a[i]) : "hole") + ","; return s; }
function make(n) { return new Array(n); }
function attempt(f) { try { return show(f()); } catch (e) { return e.constructor.name; } }
for (const given of [0, 1, 3, 126, 127, 128, 500, "4", 2.5, -1, 4294967295, 4294967296, undefined, null, NaN, -0, 3.0, [2], {}, true, 2n]) lines.push(attempt(() => make(given)));
class Rows { constructor(n, fill) { this.list = new Array(n); for (let i = 0; i < n; i++) if (fill(i) !== Rows) this.list[i] = fill(i); } }
const fills = { whole: (i) => i, half: (i) => i + 0.5, either: (i) => (i & 1 ? i : i / 4), texts: (i) => "t" + i, objects: (i) => ({ v: i }), absent: (i) => (i === 1 ? Rows : i / 2), nan: () => NaN, zero: () => -0, undef: () => undefined, large: (i) => 2 ** 31 + i };
for (const name of Object.keys(fills)) {
  const kept = [];
  for (let round = 0; round < 300; round++) { const a = new Rows(round % 5, fills[name]).list; if (round % 60 === 34) kept.push(a); }
  for (const a of kept) { a.push(fills[name](9)); lines.push(name + " " + show(a) + " " + a.length + " " + a.indexOf(fills[name](0)) + " " + (1 in a) + " " + show(a.slice().reverse())); }
}
// One site whose lists hold whole numbers, then fractions, then texts.
function row(n, round) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = round < 400 ? i : round < 900 ? i / 2 : round % 7 ? i / 2 : "x"; return a; }
let sum = 0, texts = 0;
for (let round = 0; round < 2000; round++) { const a = row(4, round); for (let i = 0; i < a.length; i++) typeof a[i] === "number" ? (sum += a[i]) : texts++; if (round % 499 === 3) lines.push(show(a) + " " + JSON.stringify(a)); }
lines.push(sum + " " + texts);
// Rows of a matrix, read as numbers and stored in turns.
function Matrix(r, c) { this.rows = []; for (let i = 0; i < r; i++) this.rows[i] = new Array(c); }
let total = 0;
for (let round = 0; round < 500; round++) { const m = new Matrix(3, 4); for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) m.rows[i][j] = round & 1 ? i * j : i + j / 8; for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) total += m.rows[i][j] * 2; if (round === 499) lines.push(show(m.rows[2])); }
lines.push(total);
console.log(lines.join("\n"));
