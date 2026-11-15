// A number that some objects hold late, in arithmetic and beside tests for undefined and null.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
class Late {
  constructor(u) {
    this.u = u;
  }
}
function arithmetic(o) {
  return [o.t - 1, o.t * 2, -o.t, o.t + o.u, 2 * o.t - o.u, o.t % 3, o.t / 2, o.t | 0, (o.t - 1) + (o.t === undefined ? 100 : 0), o.t === undefined ? "u" : o.t + 1, o.t == null ? "n" : o.t * o.t, o.t > 1 ? o.t : -1];
}
function sum(list) {
  let s = 0, k = 0;
  for (const o of list) {
    if (o.t !== undefined) s += o.t - 1;
    k = (k + o.t - o.u) | 0;
  }
  return show(s) + " " + k;
}
function step(o) {
  const before = o.t - 1;
  o.t += 1;
  const after = o.t - 1;
  o.u = o.t-- - 1;
  return [before, after, o.t, o.u];
}
for (const given of [[3, 4, -1], [0.5, 7, NaN], [3, undefined, 5], [3, null, 5.5], [2147483647, -0, 1e300]]) {
  for (let round = 0; round < 3; round++) {
    const list = [];
    for (let k = 0; k < 9; k++) {
      const o = new Late(k / 2);
      if (k % 4) o.t = given[k % 4 - 1];
      list.push(o);
    }
    for (const o of list) console.log(arithmetic(o).map(show).join(), step(o).map(show).join());
    console.log(sum(list));
  }
}
