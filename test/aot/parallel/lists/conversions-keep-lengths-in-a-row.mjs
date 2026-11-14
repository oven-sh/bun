// As conversions-keep-lengths.mjs, by two loops in a row.
function run(a, b, n) { let s = 0, t = 0; const length = a.length; for (let i = 0; i < length; i++) { a[i] = Math.abs(b[i]) + a[i]; } for (let i = 0; i < length; i++) { a[i] = Math.abs(b[i]) + a[i]; } for (let i = 0; i < length; i++) t += a[i]; return [s, t]; }
const show = x => (Object.is(x, -0) ? '-0' : String(x));
for (let turn = 0; turn < 3; turn++) {
  const p = Array.from({ length: 5 }, (_, k) => 250 + (k % 12));
  let q = Array.from({ length: 5 }, (_, k) => 250 + (k % 12)).reverse();
  if (turn) p[2] = 1.5;
  const r = run(p, q, 251);
  console.log(show(r[0]), show(r[1]), Array.from(p, show).join(), Array.from(q, show).join());
}
