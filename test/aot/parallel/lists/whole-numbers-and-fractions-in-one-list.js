// A list under two names: one name is stored fractions into, the other whole numbers. The list is converted to doubles in front of the loop under the first name and tested for int32s under the second.
const table = new Array(4).fill(2);
const say = list => Array.from(list, x => Object.is(x, -0) ? "-0" : String(x)).join();
function wholeBehindFraction(a, given) { let seen = 0, i = 0; for (;;) { if (i++ > 1) break; let k = 2; while (k-- > 0) { given[1] = table[1] + a; table[1] = i; seen += typeof given[1] === "number" ? given[1] : 100; } } return seen; }
function rounded(a, given, other) { let seen = 0; for (let i = 0; i < 2; i++) for (let k = 1; k >= 0; k--) { given[k & 3] = a + a; other[i & 3] = Math.round(a); seen += typeof given[1] === "number" ? given[1] : 100; } return seen; }
function bothGiven(a, given, other) { let seen = 0; for (let i = 0; i < 3; i++) { given[i] = a / 2; other[i] = i; seen += given[i]; } return seen; }
function wholeFirst(a, given, other) { let seen = 0; for (let i = 0; i < 3; i++) { other[i] = i; given[i] = a / 2; seen += other[i]; } return seen; }
function threeNames(a, given, other) { let seen = 0; for (let i = 0; i < 3; i++) { given[i] = a * 0.5; other[i] = i; table[i] = i + 1; seen += given[i] + other[i]; } return seen; }
function readsWhole(a, given, other) { let seen = 0; for (let i = 0; i < 3; i++) { given[i] = other[i] + a; seen += other[i] | 0; } return seen; }
function rows(a, grid) { let seen = 0; for (let i = 0; i < grid.length - 1; i++) { const row = grid[i], next = grid[i + 1]; for (let k = 0; k < 3; k++) { row[k] = a / 2; next[k] = k; seen += row[k]; } } return seen; }
const made = [() => new Array(4).fill(2), () => [2, 2, 2, 2], () => [2, 2.5, 2, 2], () => [2, "x", 2, 2], () => [2, , 2, 2], () => new Float64Array(4).fill(2)];
for (const form of [wholeBehindFraction, rounded, bothGiven, wholeFirst, threeNames, readsWhole]) for (const a of [0.5, 3, -2.5, 7]) for (const make of made) {
  const one = make(), two = make();
  console.log(form.name, a, form(a, table, table), say(table), form(a, one, one), say(one), form(a, one, one), say(one), form(a, one, two), say(one), say(two), form(a, two, table), say(two), say(table));
  table.fill(2);
}
for (const a of [0.5, 3, -2.5]) for (const make of made) { const row = make(); console.log("rows", a, rows(a, [row, row, make()]), say(row), rows(a, [make(), row]), say(row)); }
