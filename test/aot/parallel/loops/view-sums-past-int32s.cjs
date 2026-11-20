// The counter of the sums starts below the int32s, and its first step wraps around.
// STATISTIC: ViewSumNests >= 1
function sums(a, y, distance) {
  const first = -2147483648 - (distance & 15);
  for (let i = 0; i < 8; i++) {
    let s = 0, position = 0;
    for (let k = first; k < -2147483640; k = k + 1 | 0) {
      s += a[position];
      position = position + 1 | 0;
    }
    y[i] = s;
  }
}
const a = new Float64Array(50), y = new Float64Array(8);
for (let i = 0; i < 50; i++) a[i] = i + 1;
for (const distance of [0, 12, 3, 9]) {
  y.fill(0);
  sums(a, y, distance);
  console.log(distance, Array.from(y).join(" "));
}
