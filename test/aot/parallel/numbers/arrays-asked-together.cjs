// STATISTIC: RowStoreRegionsRestartingIterations >= 3
// Functions over several small arrays under constant indexes, called in loops over arrays of arrays. One array is not as the others are.
const show = v => (Object.is(v, -0) ? "-0" : "" + v);
function text(rows) {
  let t = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) t += "none ";
    else for (let k = 0; k < row.length; k++) t += show(row[k]) + (k === row.length - 1 ? " " : ",");
  }
  return t;
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function add(o, a, b) {
  o[0] = a[0] + b[0];
  o[1] = a[1] + b[1];
  o[2] = a[2] + b[2];
  return o;
}
function cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
}
function rotate(p, c, s) {
  const x = p[0], y = p[1];
  p[0] = x * c - y * s;
  p[1] = x * s + y * c;
  return p;
}
function scale(o, a, k) {
  o[0] = a[0] * k;
  o[1] = a[1] * k;
  o[2] = a[2] * k;
  return o;
}
function dots(as, bs, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + dot(as[i], bs[i]);
  return s;
}
function adds(os, as, bs, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + Number(add(os[i], as[i], bs[i])[1]);
  return s;
}
function crosses(os, as, bs, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + Number(cross(os[i], as[i], bs[i])[2]);
  return s;
}
function rotations(os, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + Number(rotate(os[i], 0.75, 0.5)[0]);
  return s;
}
function scales(os, as, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + Number(scale(os[i], as[i], i * 0.25)[2]);
  return s;
}
const names = ["nothing", "short", "hole", "nan", "integers", "boxed", "alias", "infinity", "zero"];
function one(name, which) {
  const os = [], as = [], bs = [];
  for (let i = 0; i < 8; i++) {
    os.push([0.5, 0.25, 0.125]);
    as.push([i + 0.5, i * 0.25, 3.5]);
    bs.push([0.5, i * 1.5 + 0.25, 2.5]);
  }
  const v = which === 0 ? os : which === 1 ? as : bs;
  if (name === "short") v[3].length = 1;
  if (name === "hole") delete v[4][1];
  if (name === "nan") v[5][2] = NaN;
  if (name === "integers") v[1] = [1, 2, 3];
  if (name === "boxed") {
    v[7] = [1.5, undefined, 2.5];
    v[7][1] = 4;
  }
  if (name === "alias") {
    os[4] = as[4];
    bs[5] = os[5];
  }
  if (name === "infinity") v[2][0] = Infinity;
  if (name === "zero") v[2][1] = -0;
  let said = "";
  said += show(dots(as, bs, 8));
  said += " " + show(adds(os, as, bs, 8));
  said += " " + show(crosses(os, as, bs, 8));
  said += " " + show(rotations(os, 8));
  said += " " + show(scales(os, as, 8));
  console.log(name, which, said);
  console.log(text(os) + "| " + text(as));
}
for (const name of names) for (let which = 0; which < 3; which++) one(name, which);
