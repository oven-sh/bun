// STATISTIC: RowStoreRegionsRestartingIterations >= 2
// Calls of Math between the elements of several small arrays.
const as = [], bs = [], os = [], ps = [];
for (let k = 0; k < 32; k++) {
  as.push([k + 0.5, k * 0.25, 3.5]);
  bs.push([0.5, k * 1.5 + 0.25, 2.5]);
  os.push([0.5, 0.5, 0.5]);
  ps.push([0.5, 0.5, 0.5]);
}
function least(o, a, b) {
  o[0] = Math.min(a[0], b[0]);
  o[1] = Math.min(a[1], b[1]);
  o[2] = Math.max(a[2], b[2]);
  return o;
}
function lengths(o, a, b) {
  o[0] = Math.sqrt(a[0] * a[0] + b[0] * b[0]);
  o[1] = Math.abs(a[1] - b[1]);
  o[2] = Math.floor(a[2] * b[2]);
  return o;
}
function leastAt(i) {
  return least(os[i], as[i], bs[i])[1];
}
function lengthsAt(i) {
  return lengths(ps[i], as[i], bs[i])[0];
}
function leasts(n) {
  let s = 0;
  for (let r = 0; r < n; r++) for (let i = 0; i < 32; i++) s = s * 0.5 + leastAt(i);
  return s;
}
function allLengths(n) {
  let s = 0;
  for (let r = 0; r < n; r++) for (let i = 0; i < 32; i++) s = s * 0.5 + lengthsAt(i);
  return s;
}
const show = v => (Object.is(v, -0) ? "-0" : "" + v);
function say(name) {
  let t = name + " " + show(leasts(2)) + " " + show(allLengths(2));
  for (let i = 0; i < 32; i++) for (let k = 0; k < 3; k++) t += " " + show(os[i][k]) + " " + show(ps[i][k]);
  console.log(t);
}
say("doubles");
as[5][1] = NaN;
say("NaN");
bs[7][0] = -0;
as[7][0] = 0;
say("zeros");
as[9][2] = Infinity;
say("infinity");
as[11] = [1, 2, 3];
bs[12] = [4, 5, 6];
say("integers");
os[13] = as[13];
ps[14] = bs[14];
say("alias");
os[15] = [1, 2, 3];
say("stored integers");
