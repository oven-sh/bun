// Loops that add a constant: starts with fractions, -0, beyond 2 ** 52; bounds around the iterations laid out; ways out of the middle.
const show = v => Object.is(v, -0) ? '-0' : String(v);
function threes(bound, start) { let n = start; for (let k = 0; k < bound; k++) n += 3; return n; }
function down(bound, start) { let n = start; for (let k = bound; k > 0; k--) n += -7; return n; }
function zeros(bound, start) { let n = start; for (let k = 0; k < bound; k++) n += 0; return n; }
function large(bound, start) { let n = start; for (let k = 0; k < bound; k++) n += 2147483647; return n; }
function halves(bound, start) { let n = start; for (let k = 0; k < bound; k++) n += 0.5; return n; }
function pair(bound, start) { let n = start, m = 1; for (let k = 0; k <= bound; k += 2) { n += 5; m += k; } return n + ' ' + m; }
function until(bound, start) { let n = start; for (let k = 0; k < bound; k++) { n += 9; if (n > 4000) break; } return n; }
const key = Symbol('key'), o = { [key]: 1, a: 2 };
function fields(bound) { let n = 0; for (let k = 0; k < bound; k++) n += o[key] + o.a; return n; }
for (const bound of [0, 1, 7, 8, 9, 15, 16, 17, 100, 1048579])
  for (const start of [0, -0, 1, 0.25, 2 ** 52, 2 ** 53 - 1, -(2 ** 53), NaN, Infinity, 1e300])
    console.log(bound, show(start), show(threes(bound, start)), show(down(bound, start)), show(zeros(bound, start)), show(large(bound, start)), show(halves(bound, start)), pair(bound, start), show(until(bound, start)));
console.log(fields(0), fields(17), fields(1000003));
console.log(threes(3, 'x'), threes(2, undefined), threes(2, null), threes(2, true));
