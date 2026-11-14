// STATISTIC: ArraysGuardedForReads >= 1
// Several elements of one array are read in arms by its kind: in iterations that store, and where every row is proven to be an array. Elements of two rows are compared.
const as = [], bs = [], os = [];
for (let k = 0; k < 24; k++) {
  as.push([k + 0.5, k * 0.25 - 2.5, 3.5]);
  bs.push([k & 1 ? k + 0.5 : 0.5, k * 1.5 + 0.25, 2.5]);
  os.push([0.5, 0.5, 0.5]);
}
function norm(o, a) {
  const x = a[0], y = a[1], z = a[2];
  let l = x * x + y * y + z * z;
  if (l > 0) l = 1 / Math.sqrt(l);
  o[0] = x * l;
  o[1] = y * l;
  o[2] = z * l;
  return o;
}
function normAt(i) {
  return norm(os[i], as[i])[1];
}
function norms(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + normAt(i);
  return s;
}
function grow(box, p) {
  if (p[0] < box[0]) box[0] = p[0];
  if (p[1] < box[1]) box[1] = p[1];
  if (p[2] > box[2]) box[2] = p[2];
  return box;
}
function growAt(i) {
  os[i][0] = 1e9;
  return grow(os[i], as[i])[0];
}
function grows(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + growAt(i);
  return s;
}
function equals(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
function before(a, b) {
  if (a[0] < b[0]) return 1;
  if (a[0] > b[0]) return 2;
  return a[1] < b[1] ? 3 : a[1] > b[1] ? 4 : 5;
}
function counts(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += (equals(as[i], bs[i]) ? 1 : 2) + before(as[i], bs[i]) * 10;
  return s;
}
const points = [];
for (let i = 0; i < 24; i++) points.push([i + 0.5, i * 0.25 + 0.125, 3.5]);
function total(a) {
  return a[0] + a[1] + a[2];
}
function middle(a) {
  return (a[0] - a[2]) / 2;
}
function totals(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + total(points[i]) - middle(points[i]);
  return s;
}
const show = v => (Object.is(v, -0) ? "-0" : "" + v);
function say(name) {
  let t = name + " " + show(counts(24)) + " " + show(norms(24)) + " " + show(grows(24)) + " " + show(counts(24)) + " " + show(totals(24));
  for (let i = 0; i < 24; i++) for (let k = 0; k < 3; k++) t += " " + show(os[i][k]);
  console.log(t);
}
say("doubles");
as[3] = [1, 2, 3];
points[3] = [1, 2, 3];
bs[3] = [1, 2, 3];
say("integers");
as[5] = [0, -0, 0];
say("zeros");
as[7][1] = NaN;
points[7][2] = NaN;
say("NaN");
as[8][2] = undefined;
bs[8][2] = undefined;
say("undefined");
as[9] = [1.5, , 2.5];
points[9][1] = -0;
bs[9] = [1.5, , 2.5];
say("holes");
as[10].length = 1;
points[10].length = 2;
say("short");
as[11] = ["1", "2", "3"];
bs[11] = ["1", "2", "3"];
say("strings");
as[12] = os[12];
say("alias");
os[13] = as[13];
bs[13] = as[13];
say("aliases");
as[14] = [{ valueOf() { os[15] = as[16]; return 2.5; } }, 1.5, 2.5];
say("valueOf");
