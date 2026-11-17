// STATISTIC: CallsInlined >= 6
// The rows have the names of the one literal of the file that has them, and not its shape: they come out of JSON. The loop is built twice; its typed copy counts on the literal's shape, guessed by the names used off
// a row alone, and is left in the first turn. All the turns that are left run in the other copy: it opens guesses of its own, so the three helpers are copied into it too.
'use strict';
const ROWS = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ id: i, name: 'item' + i, weight: (i * 7) % 5 + 0.5, kind: i % 3 }))));
const a = x => { x = x / 2 + 1; return x * x; }, b = x => { x = x + 1; if (x > 50) x = 50; return -(Math.round(x * 10) / 10); }, c = x => { x = x * x / 2; if (x > 50) x = 50; return Math.round((x + 1) * 10) / 10; };
function f(t) { let s = 0; for (const row of ROWS) { const k = (row.kind + t) % 3, x = row.weight + row.id; s += k === 0 ? a(x) : k === 1 ? b(x) : c(x); } return Math.abs(s); }
const n = +(process.argv[2] ?? 300); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
