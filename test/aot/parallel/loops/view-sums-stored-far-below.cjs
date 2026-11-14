// The stores of sums over a view reach so far below another view of the same buffer that no address is there. The first one changes what is read.
// STATISTIC: ViewSumNests >= 1
function scatter(a, y, z) {
  for (let i = 0; i < 16; i++) {
    let s = 0;
    for (let k = 0; k < 16; k++) s += a[k] * 0.5;
    y[10 - i * 2147483647 * 4000] = s;
    z[i] = s;
  }
}
const buffer = new ArrayBuffer(400), a = new Float64Array(buffer), y = new Float64Array(buffer), z = new Float64Array(16);
for (let i = 0; i < 50; i++) a[i] = i + 1;
scatter(a, y, z);
console.log(Array.from(y).join(" "));
console.log(Array.from(z).join(" "));
