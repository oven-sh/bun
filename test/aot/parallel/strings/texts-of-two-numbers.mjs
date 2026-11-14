// STATISTIC: NumberTextsHoisted >= 2
// Two numbers in one loop, in loops inside loops, under try: each keeps its own text.
function two(n, a, b) { let s = ""; for (let i = 0; i < n; i++) { s += a; s += b; } return s; }
function nested(n, a, b, c) { let s = ""; for (let i = 0; i < n; i++) { s += a; for (let j = 0; j < 2; j++) { s += b; s = c + s; } } return s; }
function tried(n, a, b) { let s = ""; for (let i = 0; i < n; i++) { try { s += a; if (i === 1) throw b; s += b; } catch (e) { s = s + "<" + e + ">"; s += a; } } return s; }
const said = [];
for (const a of [1.5, 2.25, "t", null, -0, NaN, 1e21])
  for (const b of [0.5, 2.25, undefined, "u", 7, Infinity]) said.push(two(3, a, b), nested(2, a, b, 3.5), nested(2, b, 0.125, a), tried(3, a, b));
console.log(said.join("\n"));
