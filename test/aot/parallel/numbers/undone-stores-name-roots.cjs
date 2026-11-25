// STATISTIC: UndoableStoresMergedAtJoins >= 3
// The condition of a path narrows the index that the path stores under. What a later check puts back does not go by the narrowed name.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? '"' + v + '"' : "" + v);
function text(list) {
  let t = "";
  for (let i = 0; i < list.length; i++) t += (i in list ? show(list[i]) : "-") + " ";
  return t + "#" + list.length;
}
function two(a, d, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 1) a[i] *= 0.5;
    if (s > 3) a[i - 1] = 1;
    else a[0] *= 0.5;
    s += d[i] * 2;
  }
  return s;
}
function one(a, d, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 1) a[i] *= 0.5;
    s += d[i] * 2;
  }
  return s;
}
function bounded(a, b, d, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 1 && i < 5) {
      a[i] = d[i] * 0.5;
      if (i > 2) b[i] = a[i] + 0.25;
    } else if (i < 1) b[i] *= 0.5;
    d[i] = d[i] * 2 + b[i];
  }
  return s;
}
function leaves(a, d, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 2) {
      a[i] *= 0.5;
      if (a[i] > 1) continue;
    }
    d[i] = d[i] * 0.5 + a[i];
    s += d[i];
  }
  return s;
}
for (const odd of [0.25, NaN, undefined, "7", "hole"]) {
  for (let at = 0; at < 6; at++) {
    const a = [5, 4, 3.5, 2, 1, 0], b = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], d = [1, 2, 3, 4, 5, 6.5];
    if (odd === "hole") delete d[at];
    else d[at] = odd;
    console.log(odd, at, show(two(a, d, 6)), text(a), show(one(a, d, 6)), text(a), show(bounded(a, b, d, 6)), text(b), text(d), show(leaves(a, d, 6)), text(a), text(d));
  }
}
