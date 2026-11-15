// A number that is stepped before a loop: what enters as undefined, a fraction, -0, the least and the largest int32, and what lies beyond them.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function down(a, n) {
  let s = 0;
  while (--n >= 0) s += a[n];
  return s + ":" + show(n);
}
function twice(a, n) {
  let s = 0;
  --n;
  --n;
  while (n >= 0) {
    s = (s * 3 + a[n]) | 0;
    n--;
  }
  return s + ":" + show(n);
}
function up(a, n) {
  if (n < -100 || n > 100) return "far";
  let i = n, s = 0;
  ++i;
  for (; i < a.length; i++) s += a[i] & 255;
  return s + ":" + show(i);
}
function store(a, i, b, j, n) {
  while (--n >= 0) b[j++] = a[i++];
  return [i, j, n].map(show).join() + "=" + b.join();
}
class Big {
  constructor(a) {
    this.array = a;
  }
}
const lists = [() => [1, 2, 3, 4, 5, 6, 7, 8], () => [0.5, 2, 3.5, 4, 5, 6, 7, 8], () => [1, , 3, 4, , 6, 7, 8], () => new Int32Array(8).fill(9)];
const numbers = [0, 1, 2, 3, 4, 5, 7, 8, -1, -0, 0.5, 3.5, NaN, undefined, -2147483648, -2147483647, -2147483649];
for (let round = 0; round < 3; round++) {
  for (const list of lists) {
    for (const n of numbers) {
      console.log(show(n), down(list(), n), twice(list(), n), up(list(), n), store(list(), 0, list(), 1, n > 6 ? 6 : n));
    }
    const p = new Big(list());
    console.log(down(p.array, p.t), twice(p.array, p.t));
    p.t = 5;
    console.log(down(p.array, p.t), twice(p.array, p.t), store(p.array, 1, p.array, 0, p.t));
  }
}
