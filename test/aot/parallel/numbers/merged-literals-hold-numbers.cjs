// STATISTIC: MergedLiteralsAllocatedNumeric >= 1
// condition ? [a, b, c] : [d, e, f]: one literal of the numbers that meet. Later stores change what it holds.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? '"' + v + '"' : "" + v);
function doubles(n) {
  const points = [];
  for (let i = 0; i < n; i++) points.push(i & 3 ? [i + 0.5, i * 0.25 + 0.125, 3.5] : [i + 0.25, i * 0.5 + 0.125, 1.5]);
  return points;
}
function integers(n) {
  const points = [];
  for (let i = 0; i < n; i++) points.push(i & 3 ? [i, i + 1, 3] : [i + 2, i + 3, 4]);
  return points;
}
function either(n, x) {
  const points = [];
  for (let i = 0; i < n; i++) points.push(i & 3 ? [i * x, i / x, 3.5] : [i, i + 1, 3]);
  return points;
}
function sum(a) {
  return a[0] + a[1] + a[2];
}
function total(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) s = s * 0.5 + sum(points[i]);
  return s;
}
for (const points of [doubles(16), integers(16), either(16, 1.5), either(16, 0), either(16, NaN), either(16, Infinity)]) {
  console.log(show(total(points)), points.map(p => p.map(show).join(",")).join(" "));
  points[3][1] = "7";
  points[4][0] = undefined;
  points[5][2] = { valueOf: () => 2.5 };
  points[6].push(0.5, "x");
  points[7].length = 1;
  points[8][5] = 1.5;
  delete points[9][1];
  points[10][0] = NaN;
  points[11][1] = -0;
  points[12][0] += 0.5;
  points[13][0] = 2 ** 40;
  console.log(show(total(points)), points.map(p => p.length + ":" + Object.keys(p).join("") + ":" + p.map(show).join(",")).join(" "));
}
