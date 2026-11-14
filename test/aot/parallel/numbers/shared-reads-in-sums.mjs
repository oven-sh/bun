// STATISTIC: SharedReadsReckonedWithAsNumbers >= 1
// sum += x; products += x * y: a field of an unknown object that several operators take is asked for a number in each iteration.
const parse = value => JSON.parse(JSON.stringify(value));
function fit(points, r) {
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
  for (const { x, y } of points) {
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }
  const n = points.length,
    m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return m + (sy - m * sx) / n + r;
}
function moments(points) {
  let a = 0,
    b = 0,
    c = 0;
  for (let i = 0; i < points.length; i++) {
    const x = points[i].x,
      y = points[i].y;
    a += x;
    b += y;
    c += x * y;
  }
  return [a, b, c];
}
const points = parse(Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2.5 + (i % 3) })));
let total = 0;
for (let r = 0; r < 20; r++) total = total * 0.5 + fit(points, r);
console.log(total, moments(points).join());
points[20].x = "7";
points[30].y = undefined;
console.log(fit(points, 1), moments(points).join());
