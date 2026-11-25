// Elements read under a remainder or a counter that an operator on bits takes, beside an iteration over the same list: numbers, fractions, holes, reads past the end.
function steps(l, n) {
  let k = 0, i = 0;
  for (const e of l) {
    k += l[i % l.length] | 0;
    i++;
    if (i >= n) break;
  }
  return k;
}
function past(l, n) {
  let k = 0, i = 0;
  for (const e of l) {
    k += l[i + 2] | 0;
    i++;
    if (i >= n) break;
  }
  return k;
}
function shifts(l, n) {
  let k = 0, i = 0;
  for (const e of l) {
    k ^= l[(i * 3) % l.length] >>> 1;
    k += ~l[i + 1];
    i++;
    if (i >= n) break;
  }
  return k;
}
function tested(l, n) {
  let k = 0;
  for (let i = 0; i < n; i++) if (l[i % l.length] & 1) k += l[i] | 0;
  return k;
}
console.log(steps([1, 2, 3, 0.5], 8));
for (let times = 0; times < 2; times++) {
  for (const make of [() => [1, 2, 3, 0.5], () => [0.5, 1.5, 2.5], () => [1, 2, 3], () => [1, , 3, 4], () => [0.5, , 2.5], () => [NaN, -0, Infinity, 4294967297.5], () => ["1", 2, null], () => [], () => [{ valueOf: () => 5 }, 2]]) {
    const said = [];
    for (const run of [steps, past, shifts, tested]) said.push(run(make(), 3), run(make(), 8));
    console.log(said.join());
  }
}
