// reduce() without a start: the first element is the accumulator. Lists of int32s, doubles, holes, texts; lists that change while they are reduced.
const show = v => Object.is(v, -0) ? '-0' : typeof v === 'object' && v ? JSON.stringify(v) : String(v);
const lists = [[1, 9, 3, 4, 5], [-5, -2, -9], [42], [0, -0, 0], [-0, 0], [1.5, 9.25, 3], [1, 2.5, 3], [1, NaN, 3], [2147483647, -2147483648, 5], [2147483648, 5], [1, , 3, 8], ['b', 'a', 'c'], [1, '5', 3], [undefined, 4, 2], [null, 4], Array.from({ length: 60 }, (_, i) => (i * 37) % 101)];
const greatest = l => l.reduce((a, b) => (a > b ? a : b)), least = l => l.reduce((a, b) => (b < a ? b : a)), sum = l => l.reduce((a, b) => a + b), mathMax = l => l.reduce((a, b) => Math.max(a, b)), last = l => l.reduce((a, b) => b), mixed = l => l.reduce((a, b) => (b > 4 ? 't' + b : a));
const fixed = [1, 9, 3, 4, 5];
function turns(n) { let t = 0; for (let k = 0; k < n; k++) t += fixed.reduce((a, b) => (a > b ? a : b)); return t; }
console.log(turns(100));
for (let round = 0; round < 3; round++)
  for (const l of lists) console.log(show(greatest(l)), show(least(l)), show(sum(l)), show(mathMax(l)), show(last(l)), show(mixed(l)));
try { greatest([]); } catch (error) { console.log(error.name); }
let hot = true;
const grows = l => l.reduce((a, b, i) => { if (hot && i === 2) l[3] = 0.5; return a > b ? a : b; }), texts = l => l.reduce((a, b, i) => { if (hot && i === 2) l[3] = 'x'; return a > b ? a : b; }), cuts = l => l.reduce((a, b, i) => { if (hot && i === 1) l.length = 2; return a > b ? a : b; });
for (const change of [grows, texts, cuts]) for (let k = 0; k < 4; k++) { hot = k % 2 === 1; console.log(show(change([7, 1, 2, 9, 4]))); }
fixed[2] = 10.5; console.log(turns(3)); fixed[1] = 'z'; console.log(turns(2)); fixed.length = 1; console.log(turns(2));
