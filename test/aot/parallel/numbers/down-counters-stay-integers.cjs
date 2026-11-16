// STATISTIC: LoweredCountersReadAfterLoops >= 1
// while (a[j] > pivot) j-- inside a specialized loop: each iteration checks j for an int32, so it stays an integer.
const base = Array.from({ length: 64 }, (_, i) => (i * 37) % 101);
function work(r) {
  const a = base.slice(),
    k = r % 64;
  let lo = 0,
    hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo,
      j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}
const sorted = base.slice().sort((x, y) => x - y);
let total = 0;
for (let r = 0; r < 64; r++) {
  if (work(r) !== sorted[r]) throw new Error("selected " + r);
  total = total * 0.5 + work(r);
}
console.log(total, work(0), work(31), work(63));
